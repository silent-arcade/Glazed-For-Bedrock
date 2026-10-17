// Render helpers and client controls. Everything here only changes what your own game shows.
const { key } = require('../core')
const gui = require('../gui')
const { shortName } = require('../util')

const NIGHT_VISION = 16
const FOREVER_TICKS = 30000000

module.exports = [
  {
    name: 'fullbright',
    category: 'Render',
    description: 'See in the dark (night vision only your game knows about)',
    apply () {
      const c = this.c
      if (!c.self.runtimeId) return
      c.toClient('mob_effect', {
        runtime_entity_id: BigInt(c.self.runtimeId), event_id: 'add', effect_id: NIGHT_VISION,
        amplifier: 0, particles: false, duration: FOREVER_TICKS, tick: 0n, ambient: false
      })
    },
    onEnable () { this.apply() },
    onDisable () {
      const c = this.c
      if (!c.self.runtimeId) return
      c.toClient('mob_effect', { runtime_entity_id: BigInt(c.self.runtimeId), event_id: 'remove', effect_id: NIGHT_VISION, amplifier: 0, particles: false, duration: 0, tick: 0n, ambient: false })
    },
    clientbound (name, p) {
      // respawning or changing dimension clears effects: put it back once the game has settled
      if (name === 'respawn' || name === 'change_dimension') setTimeout(() => this.enabled && this.apply(), 1500)
      // keep the server from removing it (e.g. when a real night vision potion runs out)
      if (name === 'mob_effect' && p.event_id === 'remove' && p.effect_id === NIGHT_VISION && key(p.runtime_entity_id) === this.c.self.runtimeId) return false
    }
  },

  {
    // Meteor-style nametags: a floating tag above every other player with name, distance and held item,
    // visible through walls. The game ignores changes to an existing tag, so a moved/changed tag is re-spawned.
    name: 'nametags',
    category: 'Render',
    description: 'Big tag over every player: name, distance, held item (through walls)',
    settings: {
      distance: { type: 'bool', default: true, desc: 'Show distance' },
      'held-item': { type: 'bool', default: true, desc: 'Show the item they are holding' },
      'mark-staff': { type: 'bool', default: true, desc: 'Mark players on the Admin List as STAFF' },
      items: { type: 'bool', default: true, desc: 'Tag dropped items with their name and count' }
    },
    onEnable () { this.held = new Map(); this.items = new Map(); this.last = 0 },
    onDisable () { this.c.clearLabels('nametags:') },
    text (e) {
      const c = this.c
      const staff = this.s['mark-staff'] && c.modules.get('admin-list')?.s.names.map(n => n.toLowerCase()).includes(e.username.toLowerCase())
      const d = Math.round(Math.hypot(e.pos.x - c.self.pos.x, e.pos.z - c.self.pos.z))
      const item = this.held.get(e.username)
      return [
        `${staff ? '§c[STAFF] ' : ''}§f§l${e.username}§r`,
        this.s.distance ? `§7${d}m` : '',
        this.s['held-item'] && item ? `§b${item}` : ''
      ].filter(Boolean).join(' §8| ')
    },
    clientbound (name, p) {
      if (name === 'add_item_entity' && this.s.items) {
        // The game never draws a name on dropped items, so a floating tag hovers above each one instead.
        const itemName = shortName(this.c.itemName(p.item) || 'item').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase())
        const rid = key(p.runtime_entity_id)
        const text = `§e${itemName}${p.item.count > 1 ? ` §fx${p.item.count}` : ''}`
        this.items.set(rid, { unique: key(p.entity_id_self), pos: { ...p.position }, text, shownAt: null })
      } else if ((name === 'move_entity' || name === 'move_entity_delta') && this.items.has(key(p.runtime_entity_id))) {
        const it = this.items.get(key(p.runtime_entity_id))
        if (name === 'move_entity') it.pos = { ...p.position }
        else for (const a of ['x', 'y', 'z']) if (p[a] != null) it.pos[a] = p[a]
      } else if (name === 'take_item_entity' && this.items.has(key(p.runtime_entity_id))) {
        this.dropItem(key(p.runtime_entity_id))
      } else if (name === 'mob_equipment') {
        const e = this.c.entities.get(key(p.runtime_entity_id))
        if (e?.type === 'minecraft:player' && e.username) this.held.set(e.username, shortName(this.c.itemName(p.item) || '').replace(/_/g, ' '))
      } else if (name === 'remove_entity') {
        const rid = this.c.uniqueToRuntime.get(key(p.entity_id_self))
        if (rid) this.c.clearLabels(`nametags:${rid}|`)
        for (const [irid, it] of this.items) if (it.unique === key(p.entity_id_self)) this.dropItem(irid)
      }
    },
    dropItem (rid) {
      this.items.delete(rid)
      this.c.clearLabels(`nametags:item:${rid}|`)
    },
    // just above the item, in open air (tags inside solid blocks aren't drawn)
    itemTagPos (pos) { return { x: pos.x, y: pos.y + 0.4, z: pos.z } },
    onTick () {
      const NAMETAG_REFRESH_MS = 400
      if (Date.now() - this.last < NAMETAG_REFRESH_MS) return
      this.last = Date.now()
      const c = this.c
      this.shown ||= new Map() // label key -> { text, x, y, z }
      for (const [rid, e] of c.entities) {
        if (e.type !== 'minecraft:player' || !e.username || e.username === c.self.name) continue
        const k = `nametags:${rid}|`
        // e.pos is eye height for players: put the tag over their head, above their own name
        const pos = { x: e.pos.x, y: e.pos.y + 0.7, z: e.pos.z }
        const text = this.text(e)
        const prev = this.shown.get(k)
        if (!c.labels.has(k)) { c.label(k, pos, text); this.shown.set(k, { text, ...pos }); continue }
        const moved = !prev || Math.hypot(pos.x - prev.x, pos.y - prev.y, pos.z - prev.z) > 1
        if ((moved || prev.text !== text) && c.relabel(k, text, pos)) this.shown.set(k, { text, ...pos })
      }
      // dropped items: tag appears where the item is, and follows it once it has settled after being thrown
      for (const [rid, it] of this.items) {
        const k = `nametags:item:${rid}|`
        const pos = this.itemTagPos(it.pos)
        if (!c.labels.has(k)) { c.label(k, pos, it.text); it.shown = pos; continue }
        if (Math.hypot(pos.x - it.shown.x, pos.y - it.shown.y, pos.z - it.shown.z) > 0.5 && c.relabel(k, it.text, pos)) it.shown = pos
      }
    }
  },

  {
    name: 'click-gui',
    category: 'Client',
    defaultEnabled: true,
    description: 'Open the menu with a bind (or type .gui)',
    // The game only tells the proxy about actions, not keys, so the bind is an action you can map to any key
    // in Bedrock's controls (e.g. Sneak on Right Shift, or the emote key).
    settings: {
      bind: { type: 'enum', options: ['double-sneak', 'double-jump', 'emote', 'off'], default: 'double-sneak', desc: 'double-sneak / double-jump = tap twice; emote = press the emote key and pick any emote' }
    },
    onBind () { gui.openMain(this.c) },
    serverbound (name, p) {
      const bind = this.s.bind
      if (bind === 'emote' && name === 'emote') {
        gui.openMain(this.c)
        return false // the emote itself never plays or reaches the server
      }
      const action = { 'double-sneak': 'start_sneaking', 'double-jump': 'start_jumping' }[bind]
      if (!action || name !== 'player_auth_input' || !p.input_data?.includes(action)) return
      if (this.c.modules.get('glazed-freecam')?.enabled) return // sneak/jump move you up and down there
      const DOUBLE_TAP_MS = 400
      const now = Date.now()
      if (now - (this.lastTap || 0) < DOUBLE_TAP_MS) { this.lastTap = 0; gui.openMain(this.c) } else this.lastTap = now
    }
  }
]
