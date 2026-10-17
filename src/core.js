const fs = require('fs')
const { randomUUID } = require('crypto')
const { webhook } = require('./util')
const { blockEntitiesFromLevelChunk, blockEntitiesFromSubChunk } = require('./chunk')

const LABEL_ID_BASE = 1n << 40n // fake label entities live far above any real entity id
const FLAG = { invisible: 5n, can_show_nametag: 14n, always_show_nametag: 15n }

// li64 fields decode as [high, low] pairs, the others as BigInt or number.
function key (id) { return String(Array.isArray(id) ? (BigInt(id[0]) << 32n) | BigInt(id[1] >>> 0) : id) }

class Core {
  constructor (config, configPath) {
    this.config = config
    this.configPath = configPath
    this.modules = new Map()
    this.player = null
    this.reset()
  }

  reset () {
    this.self = { runtimeId: null, uniqueId: null, pos: { x: 0, y: 0, z: 0 }, dimension: 'overworld', name: '' }
    this.players = new Map() // uuid -> username (tab list)
    this.entities = new Map() // runtime id -> { type, pos, uniqueId, username? }
    this.uniqueToRuntime = new Map()
    this.items = new Map() // network id -> item name
    this.inventory = []
    this.selectedSlot = 0
    this.commandTemplate = null
    this.labels = new Map() // label key -> fake entity id
    this.labelPos = new Map() // label key -> position
    this.labelBorn = new Map() // label key -> when its current entity was spawned
    this.blockEntities = new Map() // "x,y,z" -> block entity NBT, oldest first
    this.waypoints = new Map() // waypoint key -> locator bar group handle
    this.nextLabel = 0n
  }

  // ---------- modules & config ----------

  register (mod) {
    const saved = this.config.modules[mod.name] || {}
    mod.settings = mod.settings || {}
    mod.s = {}
    for (const [k, def] of Object.entries(mod.settings)) mod.s[k] = saved.settings?.[k] ?? def.default
    mod.enabled = false
    mod.c = this
    this.modules.set(mod.name, mod)
    if ((saved.enabled ?? mod.defaultEnabled) && !mod.oneShot) mod._wantEnabled = true
  }

  find (name) {
    const n = String(name).toLowerCase().replace(/[-_ ]/g, '')
    for (const m of this.modules.values()) if (m.name.replace(/-/g, '') === n) return m
    return null
  }

  save () {
    const out = {}
    for (const m of this.modules.values()) out[m.name] = { enabled: (m.enabled || !!m._wantEnabled) && !m.oneShot, settings: m.s }
    this.config.modules = out
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
  }

  setEnabled (mod, on, quiet) {
    mod._wantEnabled = false
    if (mod.enabled === on) {
      if (!quiet && !mod.oneShot) this.chat(`§f${mod.name} §7is already ${on ? '§aon' : '§coff'}`)
      return this.save()
    }
    if (on && !this.player) { mod._wantEnabled = !mod.oneShot; return this.save() }
    mod.enabled = on
    try {
      on ? mod.onEnable?.() : mod.onDisable?.()
    } catch (e) {
      console.error(`[${mod.name}]`, e)
    }
    if (!on) { this.clearLabels(mod.name + ':'); this.removeWaypoints(mod.name + ':') }
    if (!quiet && !(mod.oneShot && !on)) this.chat(`${on ? (mod.oneShot ? '§aRunning' : '§aEnabled') : '§cDisabled'} §f${mod.name}`)
    this.save()
  }

  toggle (mod) { this.setEnabled(mod, !mod.enabled) }

  // Which server the proxy joins. Saved, and used from the next join on (the current connection stays).
  setServer (host, port = 19132) {
    host = String(host || '').trim()
    port = Number(port)
    if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('enter a server address like play.example.net')
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be 1-65535')
    this.config.server = { host, port }
    if (this.destination) Object.assign(this.destination, { host, port }) // the live proxy reads this on each join
    this.save()
    this.chat(`§aServer set to §f${host}:${port}§a. Leave and join again to switch.`)
  }

  setSetting (mod, k, raw) {
    const def = mod.settings[k]
    if (!def) throw new Error(`unknown setting "${k}"`)
    let v
    switch (def.type) {
      case 'bool': v = typeof raw === 'boolean' ? raw : ['true', 'on', '1', 'yes'].includes(String(raw).toLowerCase()); break
      case 'int': v = Math.round(Number(raw)); if (!Number.isFinite(v)) throw new Error('not a number'); break
      case 'list': v = Array.isArray(raw) ? raw : String(raw).split(',').map(x => x.trim()).filter(Boolean); break
      case 'enum': v = String(raw).toLowerCase(); if (!def.options.includes(v)) throw new Error('options: ' + def.options.join(', ')); break
      default: v = String(raw)
    }
    mod.s[k] = v
    mod.onSettingChanged?.(k)
    this.save()
    return v
  }

  // ---------- output to the player ----------

  toClient (name, params) { this.player?.queue(name, params) }
  toServer (name, params) { this.player?.upstream?.queue(name, params) }

  chat (msg) {
    const format = this.config.chatFormat || 'chat'
    this.toClient('text', Core.textPacket(format, format === 'chat' ? msg : '§d[Glazed]§r ' + msg))
  }

  // 'chat' copies the server's own player-chat packet (source name ending in §r), which Bedrock 1.26.52 is
  // confirmed to display; it silently drops the 'raw' format.
  static textPacket (format, message, sourceName = '§dGlazed§r') {
    const base = { needs_translation: false, xuid: '', platform_chat_id: '', has_filtered_message: false }
    switch (format) {
      case 'system': return { ...base, category: 'message_only', type: 'system', message }
      case 'json': return { ...base, category: 'message_only', type: 'json', message: JSON.stringify({ rawtext: [{ text: message }] }) }
      case 'chat': return { ...base, category: 'authored', type: 'chat', source_name: sourceName, message }
      case 'translation': return { ...base, needs_translation: true, category: 'parameters', type: 'translation', message, parameters: [] }
      default: return { ...base, category: 'message_only', type: 'raw', message }
    }
  }

  title (text, sub) {
    const base = { fade_in_time: 5, stay_time: 50, fade_out_time: 10, xuid: '', platform_online_id: '', filtered_message: '' }
    if (sub) this.toClient('set_title', { ...base, type: 'set_subtitle', text: sub })
    this.toClient('set_title', { ...base, type: 'set_title', text })
  }

  // background = true for always-on HUD text (region, staff list): it waits while an alert is showing.
  actionbar (text, background = false) {
    if (background && Date.now() < Math.max(this.alertUntil || 0, this.hudUntil || 0)) return
    this.toClient('set_title', { type: 'action_bar_message', text, fade_in_time: 0, stay_time: 40, fade_out_time: 0, xuid: '', platform_online_id: '', filtered_message: '' })
  }

  // Small "found something" alert. style: actionbar | chat | both | off.
  // Actionbar alerts queue up and each shows ~2.5 s, so several finds at once don't overwrite each other.
  alert (style, msg, sound = true) {
    if (style === 'off') return
    if (style === 'chat' || style === 'both') this.chat(msg)
    if (style === 'actionbar' || style === 'both') {
      this.alertQueue ||= []
      if (this.alertQueue.length >= 4) this.alertQueue.shift()
      this.alertQueue.push({ msg, sound })
      if (!this.alertTimer) this.nextAlert()
    } else if (sound) this.sound('random.orb', 1.8)
  }

  // Waypoint beams: every ESP offers its targets; once a second only the nearest few overall get a beam,
  // because the game drops particles when too many arrive at once.
  offerBeam (b) {
    (this.beamCandidates ||= new Map()).set(`${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`, b)
  }

  renderBeams () {
    const BEAMS = 8
    const BEAM_HEIGHT = 16
    const BEAM_MS = 1000
    if (Date.now() - (this.beamAt || 0) < BEAM_MS || !this.beamCandidates?.size) return
    this.beamAt = Date.now()
    const nearest = [...this.beamCandidates.values()].sort((a, b) => a.d - b.d).slice(0, BEAMS)
    this.beamCandidates.clear()
    for (const b of nearest) {
      for (let y = 1; y <= BEAM_HEIGHT; y += 1.5) {
        this.toClient('spawn_particle_effect', {
          dimension: { overworld: 0, nether: 1, end: 2 }[this.self.dimension] ?? 0,
          entity_id: -1n,
          position: { x: b.x, y: b.y + y, z: b.z },
          particle_name: 'minecraft:endrod',
          molang_variables: undefined
        })
      }
    }
  }

  // Tracer arrow: ESP modules offer their nearest target each tick; the closest overall is shown above the hotbar.
  offerHudTarget (t) {
    if (!this.hudTarget || t.d < this.hudTarget.d) this.hudTarget = t
  }

  renderHud () {
    const t = this.hudTarget
    this.hudTarget = null
    if (!t || Date.now() < (this.alertUntil || 0) || Date.now() - (this.hudAt || 0) < 300) return
    this.hudAt = Date.now()
    this.hudUntil = Date.now() + 700
    this.toClient('set_title', { type: 'action_bar_message', text: `§e${Core.arrow(this.self, t)} §f${t.label} §7${Math.round(t.d)}m`, fade_in_time: 0, stay_time: 15, fade_out_time: 0, xuid: '', platform_online_id: '', filtered_message: '' })
  }

  // Arrow from where you're looking to the target. Bedrock yaw: 0 = south, 90 = west, turning right increases it.
  static arrow (self, t) {
    const targetYaw = Math.atan2(-(t.x - self.pos.x), t.z - self.pos.z) * 180 / Math.PI
    const rel = ((targetYaw - (self.look?.yaw ?? 0)) % 360 + 540) % 360 - 180
    return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][((Math.round(rel / 45) % 8) + 8) % 8]
  }

  nextAlert () {
    const next = this.alertQueue?.shift()
    if (!next) { this.alertTimer = null; return }
    const ALERT_MS = 2500
    this.alertUntil = Date.now() + ALERT_MS
    this.actionbar(next.msg)
    if (next.sound) this.sound('random.orb', 1.8) // one ping per alert as it appears, not a burst
    this.alertTimer = setTimeout(() => this.nextAlert(), ALERT_MS)
  }

  sound (name = 'random.orb', pitch = 1) {
    const p = this.self.pos
    // play_sound coordinates are block coordinates scaled by 8
    this.toClient('play_sound', {
      name, coordinates: { x: Math.round(p.x * 8), y: Math.round(p.y * 8), z: Math.round(p.z * 8) }, volume: 1, pitch, loop_count: 0, bypass_listener_range_check: true, handle: undefined, playback_position_seconds: undefined
    })
  }

  // mode: actionbar | chat | both (chat + actionbar) | title (big, centre screen)
  notify (mode, msg, sound = true) {
    if (mode === 'title') {
      this.title('§d' + msg.replace(/§./g, ''))
      if (sound) this.sound('note.pling', 1.5)
      return
    }
    this.alert(mode, msg, sound)
  }

  hook (mod, msg) {
    if (mod.s.webhook && mod.s['webhook-url']) webhook(mod.s['webhook-url'], msg, mod.s['self-ping'] ? mod.s['discord-id'] : '')
  }

  // Pretends the server sent a packet: it goes through every module like a real one and reaches the game only if nothing blocked it.
  simulateServer (name, params) {
    const d = { canceled: false }
    this.onClientbound(name, params, d)
    if (!d.canceled) this.toClient(name, params)
    return !d.canceled
  }

  // ---------- actions on the server ----------

  // Commands from modules go out at most one per COMMAND_GAP_MS so macros don't trip spam kicks.
  command (cmd) {
    const COMMAND_GAP_MS = 350
    const now = Date.now()
    const at = Math.max(now, (this.nextCommandAt || 0))
    if (at - now > 5000) return // backlog full: drop instead of queueing forever
    this.nextCommandAt = at + COMMAND_GAP_MS
    if (at > now) return void setTimeout(() => this.sendCommand(cmd), at - now)
    this.sendCommand(cmd)
  }

  sendCommand (cmd) {
    const t = this.commandTemplate || {
      origin: { type: 'player', uuid: this.player?.profile?.uuid || '00000000-0000-0000-0000-000000000000', request_id: '', player_entity_id: 0n },
      version: 'latest'
    }
    this.toServer('command_request', { command: '/' + cmd.replace(/^\//, ''), origin: t.origin, internal: false, version: t.version })
  }

  selectSlot (slot) {
    // The client applies the switch itself and tells the server, so both stay in sync.
    this.toClient('player_hotbar', { selected_slot: slot, window_id: 'inventory', select_slot: true })
    this.selectedSlot = slot
  }

  itemName (item) {
    if (!item || !item.network_id) return null
    return this.items.get(item.network_id) || null
  }

  hotbar () { return this.inventory.slice(0, 9).map(i => this.itemName(i)) }

  disconnect (reason) { this.player?.disconnect(reason) }

  // ---------- floating text labels (client-only invisible armor stands) ----------

  label (k, pos, text) {
    if (this.labels.has(k)) return
    const id = LABEL_ID_BASE + this.nextLabel++
    this.labels.set(k, id)
    this.labelPos.set(k, pos)
    this.labelBorn.set(k, Date.now())
    // Delay so the label arrives after the chunk it sits in.
    setTimeout(() => { if (this.labels.get(k) === id) this.spawnLabel(id, pos, text) }, 300)
  }

  spawnLabel (id, pos, text) {
    this.toClient('add_entity', {
      unique_id: id,
      runtime_id: id,
      entity_type: 'minecraft:armor_stand',
      position: pos,
      velocity: { x: 0, y: 0, z: 0 },
      pitch: 0, yaw: 0, head_yaw: 0, body_yaw: 0,
      attributes: [],
      // Bedrock 1.26 hides the name tag of invisible entities, so the stand stays visible but is shrunk to
      // 1% (unnoticeable). It must sit in open air (entities inside solid blocks aren't drawn), so callers
      // place it just above the target and the short bounding box keeps the tag right over it.
      metadata: [
        { key: 'flags', type: 'long', legacy_type: 7, value: { _value: 0n, can_show_nametag: true, always_show_nametag: true, no_ai: true } },
        { key: 'nametag', type: 'string', legacy_type: 4, value: text },
        { key: 'always_show_nametag', type: 'byte', legacy_type: 0, value: 1 },
        { key: 'scale', type: 'float', legacy_type: 3, value: 0.01 },
        { key: 'boundingbox_height', type: 'float', legacy_type: 3, value: 0.3 },
        { key: 'boundingbox_width', type: 'float', legacy_type: 3, value: 0.01 }
      ],
      properties: { ints: [], floats: [] },
      links: []
    })
  }

  // Change a label's text (e.g. a live distance). The game ignores text updates to existing tags, so a
  // replacement is spawned and the old one removed a moment later, once the new one is drawn (no blink).
  // Returns false if there's no such label.
  relabel (k, text, pos) {
    const LABEL_SWAP_MS = 250
    const LABEL_SETTLE_MS = 1500 // let a brand-new tag (and its chunk) settle before swapping it
    const old = this.labels.get(k)
    if (!old || Date.now() - (this.labelBorn.get(k) || 0) < LABEL_SETTLE_MS) return false
    const id = LABEL_ID_BASE + this.nextLabel++
    this.labels.set(k, id)
    this.labelBorn.set(k, Date.now())
    if (pos) this.labelPos.set(k, pos) // optional: move the tag too (e.g. following a player)
    this.spawnLabel(id, this.labelPos.get(k), text)
    setTimeout(() => this.toClient('remove_entity', { entity_id_self: old }), LABEL_SWAP_MS)
    return true
  }

  clearLabels (prefix = '') {
    for (const [k, id] of this.labels) {
      if (!k.startsWith(prefix)) continue
      this.toClient('remove_entity', { entity_id_self: id })
      this.labels.delete(k)
      this.labelPos.delete(k)
      this.labelBorn.delete(k)
    }
  }

  // ---------- Locator Bar waypoints (same packet shape the server uses for player dots) ----------

  // actorId: entity unique id, so the game moves the dot with the mob itself.
  waypoint (k, pos, { color = 0xffffff00, actorId } = {}) {
    if (this.waypoints.has(k)) return
    const handle = randomUUID()
    this.waypoints.set(k, handle)
    this.toClient('locator_bar', {
      waypoints: [{
        group_handle: handle,
        action: 'add',
        waypoint: {
          update_flags: 63,
          visible: true,
          world_position: { position: pos, dimension_id: { overworld: 0, nether: 1, end: 2 }[this.self.dimension] ?? 0 },
          texture_path: 'textures/ui/locator_bar_dot_0',
          icon_size: { x: 1, z: 1 },
          color: color | 0, // ARGB as a signed int
          client_position_authority: actorId != null,
          actor_unique_id: actorId != null ? BigInt(actorId) : undefined
        }
      }]
    })
  }

  removeWaypoints (prefix = '') {
    const gone = []
    for (const [k, handle] of this.waypoints) {
      if (!k.startsWith(prefix)) continue
      gone.push({ group_handle: handle, action: 'remove', waypoint: { update_flags: 0 } })
      this.waypoints.delete(k)
    }
    if (gone.length) this.toClient('locator_bar', { waypoints: gone })
  }

  countWaypoints (prefix) { let n = 0; for (const k of this.waypoints.keys()) if (k.startsWith(prefix)) n++; return n }

  isLabel (runtimeId) { return BigInt(runtimeId) >= LABEL_ID_BASE }

  // Edits an entity's metadata in place: show a nametag and/or remove invisibility.
  static patchMetadata (metadata, { nametag, reveal }) {
    let flags = metadata.find(m => m.key === 'flags')
    if (!flags) {
      if (!nametag) return
      flags = { key: 'flags', type: 'long', legacy_type: 7, value: { _value: 0n } }
      metadata.push(flags)
    }
    const v = flags.value
    if (reveal) {
      v._value = BigInt(v._value || 0n) & ~(1n << FLAG.invisible)
      v.invisible = false
    }
    if (nametag) {
      v.can_show_nametag = v.always_show_nametag = true
      const tag = metadata.find(m => m.key === 'nametag')
      if (tag) tag.value = nametag
      else metadata.push({ key: 'nametag', type: 'string', legacy_type: 4, value: nametag })
      if (!metadata.some(m => m.key === 'always_show_nametag')) metadata.push({ key: 'always_show_nametag', type: 'byte', legacy_type: 0, value: 1 })
    }
  }

  // ---------- packet handling ----------

  enabledModules () { return [...this.modules.values()].filter(m => m.enabled) }

  emit (hook, ...args) {
    for (const m of this.enabledModules()) {
      try {
        m[hook]?.(...args)
      } catch (e) {
        console.error(`[${m.name}] ${hook}:`, e)
      }
    }
  }

  onClientbound (name, params, des) {
    this.track(name, params)
    if (name === 'level_chunk' || name === 'subchunk' || name === 'block_entity_data') this.scanBlockEntities(name, params)
    for (const m of this.enabledModules()) {
      try {
        if (m.clientbound?.(name, params) === false) des.canceled = true
      } catch (e) {
        console.error(`[${m.name}] clientbound ${name}:`, e)
      }
    }
  }

  // ---------- emote binds: each emote in the wheel has its own id, so it can toggle one module ----------

  startBind (mod) {
    this.pendingBind = mod.name
    this.chat(`§fNow use the emote you want for §b${mod.name}§f (emote key, default B).`)
  }

  bindsFor (modName) { return Object.entries(this.config.binds || {}).filter(([, m]) => m === modName).map(([e]) => e) }

  unbind (modName) {
    for (const e of this.bindsFor(modName)) delete this.config.binds[e]
    this.save()
  }

  // Returns true when the emote was used as a bind (and must not play or reach the server).
  handleEmote (emoteId) {
    this.config.binds ||= {}
    if (this.pendingBind) {
      const name = this.pendingBind
      this.pendingBind = null
      this.unbind(name) // one emote per module
      this.config.binds[emoteId] = name
      this.save()
      this.chat(`§aBound §f${name}§a to that emote. Use it to turn ${name} on/off.`)
      return true
    }
    const mod = this.modules.get(this.config.binds[emoteId])
    if (!mod) return false
    this.toggle(mod)
    return true
  }

  onServerbound (name, params, des) {
    if (name === 'emote' && this.handleEmote(params.emote_id)) {
      des.canceled = true
      return
    }
    if (name === 'command_request') this.commandTemplate = { origin: params.origin, version: params.version }
    if (name === 'mob_equipment') this.selectedSlot = params.selected_slot
    if (name === 'player_auth_input') {
      this.self.pos = { x: params.position.x, y: params.position.y - 1.62, z: params.position.z }
      this.self.look = { pitch: params.pitch, yaw: params.yaw, headYaw: params.head_yaw }
    }
    if (name === 'inventory_transaction' && params.transaction.transaction_type === 'item_use_on_entity' &&
      this.isLabel(params.transaction.transaction_data.entity_runtime_id)) {
      des.canceled = true // never let the server see clicks on our fake labels
      return
    }
    for (const m of this.enabledModules()) {
      try {
        if (m.serverbound?.(name, params) === false) des.canceled = true
      } catch (e) {
        console.error(`[${m.name}] serverbound ${name}:`, e)
      }
    }
  }

  track (name, p) {
    switch (name) {
      case 'start_game':
        this.self.runtimeId = key(p.runtime_entity_id)
        this.self.uniqueId = key(p.entity_id)
        this.self.pos = { ...p.player_position }
        this.self.dimension = p.dimension
        for (const it of p.itemstates || []) this.items.set(it.runtime_id, it.name)
        break
      case 'item_registry':
        for (const it of p.itemstates) this.items.set(it.runtime_id, it.name)
        break
      case 'change_dimension':
        this.self.dimension = { 0: 'overworld', 1: 'nether', 2: 'end' }[p.dimension] ?? p.dimension
        this.entities.clear()
        this.uniqueToRuntime.clear()
        this.labels.clear() // the client drops every entity on dimension change
        this.labelPos.clear()
        this.labelBorn.clear()
        this.blockEntities.clear()
        this.removeWaypoints() // they belong to the old dimension
        break
      case 'move_player':
        if (key(p.runtime_id) === this.self.runtimeId) this.self.pos = { x: p.position.x, y: p.position.y - 1.62, z: p.position.z }
        else this.moveEntity(p.runtime_id, p.position)
        break
      case 'player_list':
        for (const r of p.records) {
          if (r.type === 'add') this.players.set(r.uuid, r.username)
          else this.players.delete(r.uuid)
        }
        break
      case 'add_player':
        this.addEntity(p.runtime_id, p.unique_id, 'minecraft:player', p.position, p.username)
        break
      case 'add_entity':
        this.addEntity(p.runtime_id, p.unique_id, p.entity_type, p.position)
        break
      case 'update_abilities':
        if (key(p.entity_unique_id) === this.self.uniqueId || !this.selfAbilities) this.selfAbilities = p // the server's real grant, for Freecam to restore
        break
      case 'remove_entity': {
        const rid = this.uniqueToRuntime.get(key(p.entity_id_self))
        if (rid) this.entities.delete(rid)
        this.uniqueToRuntime.delete(key(p.entity_id_self))
        break
      }
      case 'move_entity':
        this.moveEntity(p.runtime_entity_id, p.position)
        break
      case 'move_entity_delta': {
        const e = this.entities.get(key(p.runtime_entity_id))
        if (e) {
          if (p.x != null) e.pos.x = p.x
          if (p.y != null) e.pos.y = p.y
          if (p.z != null) e.pos.z = p.z
        }
        break
      }
      case 'inventory_content':
        if (p.window_id === 'inventory' || p.window_id === 0) this.inventory = p.input
        break
      case 'inventory_slot':
        if (p.window_id === 'inventory' || p.window_id === 0) this.inventory[p.slot] = p.item
        break
      case 'player_hotbar':
        if (p.select_slot) this.selectedSlot = p.selected_slot
        break
    }
  }

  addEntity (runtimeId, uniqueId, type, pos, username) {
    this.entities.set(key(runtimeId), { type, pos: { ...pos }, uniqueId: key(uniqueId), username })
    this.uniqueToRuntime.set(key(uniqueId), key(runtimeId))
  }


  moveEntity (runtimeId, pos) {
    const e = this.entities.get(key(runtimeId))
    if (e) e.pos = { ...pos }
  }

  scanBlockEntities (name, p) {
    const list = []
    const read = fn => { try { list.push(...fn()) } catch (e) { if (this.config.debug) console.warn('[chunk] could not read block entities:', e.message) } }
    if (name === 'level_chunk' && p.sub_chunk_count >= 0 && !p.cache_enabled) read(() => blockEntitiesFromLevelChunk(p.payload, p.sub_chunk_count))
    else if (name === 'subchunk' && !p.cache_enabled) {
      for (const e of p.entries) if (e.result === 'success' && e.payload) read(() => blockEntitiesFromSubChunk(e.payload))
    } else if (name === 'block_entity_data') read(() => [require('prismarine-nbt').simplify(p.nbt)])
    const found = list.filter(b => b && b.id)
    if (!found.length) return
    // Remembered so an ESP switched on later still sees what loaded before it (e.g. everything around you at join).
    for (const b of found) {
      const k = `${b.x},${b.y},${b.z}`
      this.blockEntities.delete(k)
      this.blockEntities.set(k, b)
      if (this.blockEntities.size > 20000) this.blockEntities.delete(this.blockEntities.keys().next().value)
    }
    this.emit('onBlockEntities', found)
  }
}

module.exports = { Core, key }
