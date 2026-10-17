// "ESP" on a proxy: no boxes can be drawn, so targets get a floating name tag (visible through walls)
// plus chat/webhook alerts.
const { Core, key } = require('../core')
const { shortName, fmtPos } = require('../util')
const { regionAt, continent } = require('../regions')

const CAT = 'ESP'
const webhookSettings = {
  webhook: { type: 'bool', default: false, desc: 'Send Discord webhook alerts' },
  'webhook-url': { type: 'string', default: '', desc: 'Discord webhook URL' },
  'self-ping': { type: 'bool', default: false, desc: 'Ping yourself in the webhook' },
  'discord-id': { type: 'string', default: '', desc: 'Your Discord user ID' }
}
const alertSetting = { type: 'enum', options: ['actionbar', 'chat', 'both', 'off'], default: 'actionbar', desc: 'Where the found-it alert shows (actionbar = small, above the hotbar)' }
const TRACER_PARTICLES = {
  endrod: 'minecraft:endrod',
  happy: 'minecraft:villager_happy',
  flame: 'minecraft:basic_flame_particle',
  heart: 'minecraft:heart_particle'
}
const tracerSettings = {
  tracers: { type: 'bool', default: false, desc: 'Particle line from you to each target (8 nearest, up to 96 blocks)' },
  'tracer-particle': { type: 'enum', options: Object.keys(TRACER_PARTICLES), default: 'endrod', desc: 'Particle the line is made of' },
  'tracer-arrow': { type: 'bool', default: false, desc: 'Arrow above the hotbar pointing to the nearest target (works through walls)' }
}
const baseSettings = {
  'name-tag': { type: 'bool', default: true, desc: 'Floating name tag on the target' },
  waypoint: { type: 'bool', default: true, desc: 'Waypoint on the target: live distance on its tag + a light beam (8 nearest)' },
  'locator-bar': { type: 'bool', default: false, desc: 'Also put a dot on the Locator Bar at the top of the screen' },
  alert: alertSetting,
  ...tracerSettings,
  ...webhookSettings
}

// A proxy can't draw lines, so a tracer is a dotted line of particles, redrawn ~3 times a second.
// It starts at chest height a step in front of you (so it's visible, not hidden inside your view)
// and the dots spread over the whole distance, packed tighter near you where direction matters most.
const TRACER_MAX_TARGETS = 8
const TRACER_RANGE = 96
const TRACER_DOTS = 24
const TRACER_REFRESH_MS = 300
const TRACER_START_OFFSET = 1.2 // blocks in front of you
const DIMENSION = { overworld: 0, nether: 1, end: 2 }
const MAX_BLOCK_WAYPOINTS = 16 // per module, so the Locator Bar stays readable
const title = name => name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

// targets: [{ x, y, z, label? }]
function drawTracers (mod, targets) {
  if (!mod.s.tracers) return
  if (mod.s['tracer-arrow']) {
    const me = mod.c.self.pos
    const nearest = targets.filter(Boolean)
      .map(t => ({ ...t, d: Math.hypot(t.x - me.x, t.z - me.z) }))
      .filter(t => t.d <= TRACER_RANGE * 2)
      .sort((a, b) => a.d - b.d)[0]
    if (nearest) mod.c.offerHudTarget({ ...nearest, label: nearest.label || title(mod.name) })
  }
  if (Date.now() - (mod._tracerAt || 0) < TRACER_REFRESH_MS) return
  mod._tracerAt = Date.now()
  const c = mod.c
  const chest = { x: c.self.pos.x, y: c.self.pos.y + 1.1, z: c.self.pos.z }
  const particle = TRACER_PARTICLES[mod.s['tracer-particle']] || TRACER_PARTICLES.endrod
  const near = targets
    .filter(Boolean)
    .map(t => ({ t, d: Math.hypot(t.x - chest.x, t.y - chest.y, t.z - chest.z) }))
    .filter(({ d }) => d > 2 && d <= TRACER_RANGE)
    .sort((a, b) => a.d - b.d)
    .slice(0, TRACER_MAX_TARGETS)
  for (const { t, d } of near) {
    const dir = { x: (t.x - chest.x) / d, y: (t.y - chest.y) / d, z: (t.z - chest.z) / d }
    const span = d - TRACER_START_OFFSET
    for (let i = 0; i < TRACER_DOTS; i++) {
      const along = TRACER_START_OFFSET + span * Math.pow(i / (TRACER_DOTS - 1), 1.6)
      c.toClient('spawn_particle_effect', {
        dimension: DIMENSION[c.self.dimension] ?? 0,
        entity_id: -1n,
        position: { x: chest.x + dir.x * along, y: chest.y + dir.y * along, z: chest.z + dir.z * along },
        particle_name: particle,
        molang_variables: undefined
      })
    }
  }
}

// In-world waypoint: the target's floating tag shows a live distance, and a column of particles rises from it
// so it can be spotted from far away. targets: [{ id, x, y, z, text, setText(text) }]
const WAYPOINT_REFRESH_MS = 1000
const WAYPOINT_TAGS = 24 // nearest targets whose distance is kept up to date
const WAYPOINT_MIN_STEP = 2 // metres
const WAYPOINT_MIN_GAP_MS = 2000
const WAYPOINT_REFRESH_TAG_MS = 5000

function drawWaypoints (mod, targets) {
  if (!mod.s.waypoint || Date.now() - (mod._waypointAt || 0) < WAYPOINT_REFRESH_MS) return
  mod._waypointAt = Date.now()
  const c = mod.c
  const me = c.self.pos
  const near = targets
    .filter(Boolean)
    .map(t => ({ t, d: Math.round(Math.hypot(t.x - me.x, t.y - me.y, t.z - me.z)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, WAYPOINT_TAGS)
  mod._wpText ||= new Map()
  mod._wpLast ||= new Map() // id -> { d, at } of the last tag change
  const now = Date.now()
  near.forEach(({ t, d }) => {
    // Each change swaps the tag, so only change it when the distance moved 2 m+ and not more than every 2 s.
    // Every 5 s it's re-spawned anyway: the game drops tags spawned before their chunk loaded (e.g. at join).
    const last = mod._wpLast.get(t.id)
    const refresh = last && now - last.at >= WAYPOINT_REFRESH_TAG_MS
    const due = !last || refresh || (Math.abs(d - last.d) >= WAYPOINT_MIN_STEP && now - last.at >= WAYPOINT_MIN_GAP_MS)
    const text = `${t.text} §7[${d}m]`
    // setText returns false while the tag isn't ready to be swapped yet; then try again next time
    if (mod.s['name-tag'] && due && (refresh || mod._wpText.get(t.id) !== text) && t.setText(text) !== false) {
      mod._wpText.set(t.id, text)
      mod._wpLast.set(t.id, { d, at: now })
    }
    if (d >= 3) c.offerBeam({ x: t.x, y: t.y, z: t.z, d })
  })
}

function partialNametag (c, runtimeId, text) {
  c.toClient('set_entity_data', {
    runtime_entity_id: BigInt(runtimeId),
    metadata: [
      { key: 'nametag', type: 'string', legacy_type: 4, value: text },
      { key: 'always_show_nametag', type: 'byte', legacy_type: 0, value: text ? 1 : 0 }
    ],
    properties: { ints: [], floats: [] },
    tick: 0n
  })
}

function entityEsp ({ name, description, types, tag, needsEquipment, color }) {
  return {
    name,
    category: CAT,
    description,
    settings: baseSettings,
    onEnable () {
      this.targets = new Set() // runtime ids found, for tracers
      this.tagged = new Set() // runtime ids with our tag
      this.alerted = new Set() // unique ids already announced
      this.pending = new Map() // runtime id -> entity, waiting for equipment
      for (const [rid, e] of this.c.entities) {
        if (!types.includes(e.type)) continue
        if (needsEquipment) this.pending.set(rid, e)
        else this.found(rid, e, null)
      }
    },
    onDisable () {
      for (const rid of this.tagged) partialNametag(this.c, rid, '')
    },
    onTick () {
      if (!this.targets) return
      const list = [...this.targets].map(rid => [rid, this.c.entities.get(rid)?.pos]).filter(([, p]) => p)
      drawTracers(this, list.map(([, p]) => ({ ...p, label: tag.replace(/§./g, '') })))
      drawWaypoints(this, list.map(([rid, p]) => ({ id: rid, ...p, text: tag, setText: t => partialNametag(this.c, rid, t) })))
    },
    found (rid, e, metadata) {
      ;(this.targets ||= new Set()).add(rid)
      if (this.s['locator-bar']) this.c.waypoint(`${name}:${rid}|`, e.pos, { color, actorId: e.uniqueId })
      if (this.s['name-tag']) {
        if (metadata) Core.patchMetadata(metadata, { nametag: tag })
        else partialNametag(this.c, rid, tag)
        this.tagged.add(rid)
      }
      // one alert per 8x8 area, so a house full of villagers is one line, not ten
      const area = `${Math.floor(e.pos.x / 8)},${Math.floor(e.pos.z / 8)}`
      if (this.alerted.has(e.uniqueId) || this.alerted.has(area)) return
      this.alerted.add(e.uniqueId)
      this.alerted.add(area)
      const msg = `${tag.replace(/§./g, '')} at ${fmtPos(e.pos)}`
      this.c.alert(this.s.alert, `§e${msg}`)
      this.c.hook(this, msg)
    },
    clientbound (pkt, p) {
      if (pkt === 'add_entity' && types.includes(p.entity_type)) {
        const rid = key(p.runtime_id)
        const e = { pos: p.position, uniqueId: key(p.unique_id) }
        if (needsEquipment) this.pending.set(rid, e)
        else this.found(rid, e, p.metadata)
      } else if (pkt === 'set_entity_data' && this.tagged.has(key(p.runtime_entity_id))) {
        // keep the distance version of the tag, not the plain one
        if (p.metadata.some(m => m.key === 'flags' || m.key === 'nametag')) Core.patchMetadata(p.metadata, { nametag: this._wpText?.get(key(p.runtime_entity_id)) || tag })
      } else if (pkt === 'mob_equipment' && needsEquipment) {
        const rid = key(p.runtime_entity_id)
        const e = this.pending.get(rid)
        if (e && needsEquipment(this.c.itemName(p.item))) {
          this.pending.delete(rid)
          setTimeout(() => this.enabled && this.found(rid, this.c.entities.get(rid) || e, null), 100)
        }
      } else if (pkt === 'remove_entity') {
        const rid = this.c.uniqueToRuntime.get(key(p.entity_id_self))
        if (rid) { this.tagged.delete(rid); this.pending.delete(rid); this.targets?.delete(rid); this.c.removeWaypoints(`${name}:${rid}|`) }
      }
    }
  }
}

function blockEsp ({ name, description, match, tag, color, extraSettings = {} }) {
  return {
    name,
    category: CAT,
    description,
    settings: { ...baseSettings, ...extraSettings },
    onEnable () {
      this.alerted = new Set()
      this.spots = new Map() // "x,y,z" -> block centre, for tracers
      this.onBlockEntities([...this.c.blockEntities.values()]) // what loaded before this was on
    },
    onTick () {
      const spots = [...this.spots.values()]
      drawTracers(this, spots)
      drawWaypoints(this, spots.map(s => ({ ...s, id: s.key, text: s.tagText, setText: t => this.c.relabel(`${this.name}:${s.key}`, t) })))
    },
    onBlockEntities (list) {
      for (const b of list) {
        if (!match.call(this, b)) continue
        const pos = `${b.x},${b.y},${b.z}`
        this.spots.set(pos, { key: pos, x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5, tagText: tag.call(this, b), label: tag.call(this, b).replace(/§./g, '') })
        const text = tag.call(this, b)
        if (this.s['name-tag']) this.c.label(`${this.name}:${pos}`, { x: b.x + 0.5, y: b.y + 1.05, z: b.z + 0.5 }, text) // in the air just above the block
        if (this.s['locator-bar'] && this.c.countWaypoints(this.name + ':') < MAX_BLOCK_WAYPOINTS) this.c.waypoint(`${this.name}:${pos}|`, { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 }, { color })
        if (this.alerted.has(pos)) continue
        this.alerted.add(pos)
        const msg = `${text.replace(/§./g, '')} at ${b.x}, ${b.y}, ${b.z}`
        this.c.alert(this.s.alert, `§e${msg}`)
        this.c.hook(this, msg)
      }
    }
  }
}

const idIs = (...ids) => function (b) { return ids.includes(b.id) }
const STORAGE_DEFAULT = ['Chest', 'Barrel', 'ShulkerBox', 'EnderChest', 'Hopper', 'Dispenser', 'Dropper']

module.exports = [
  blockEsp({
    name: 'spawner-notifier',
    color: 0xffff5555,
    description: 'Finds spawners and tags them with their mob',
    match: idIs('MobSpawner'),
    tag: b => `§c${b.EntityIdentifier ? shortName(b.EntityIdentifier) + ' ' : ''}spawner`
  }),

  {
    name: 'advanced-stash-finder',
    category: CAT,
    description: 'Flags chunks with lots of storage blocks (+ webhook, auto disconnect)',
    settings: {
      'min-storage': { type: 'int', default: 6, desc: 'Storage blocks in one chunk to count as a stash' },
      'storage-types': { type: 'list', default: STORAGE_DEFAULT, desc: 'Block entity ids that count' },
      disconnect: { type: 'bool', default: false, desc: 'Disconnect when a stash is found' },
      ...baseSettings
    },
    onEnable () {
      this.chunks = new Map()
      this.alerted = new Set()
      this.spots = []
      this.onBlockEntities([...this.c.blockEntities.values()])
    },
    onTick () {
      drawTracers(this, this.spots)
      drawWaypoints(this, this.spots.map(s => ({ ...s, id: s.key, text: s.tagText, setText: t => this.c.relabel(`${this.name}:${s.key}`, t) })))
    },
    onBlockEntities (list) {
      const types = this.s['storage-types'].map(t => t.toLowerCase())
      for (const b of list) {
        if (!types.includes(String(b.id).toLowerCase())) continue
        const ck = `${Math.floor(b.x / 16)},${Math.floor(b.z / 16)}`
        if (!this.chunks.has(ck)) this.chunks.set(ck, new Set())
        this.chunks.get(ck).add(`${b.x},${b.y},${b.z}`)
        const count = this.chunks.get(ck).size
        if (count < this.s['min-storage'] || this.alerted.has(ck)) continue
        this.alerted.add(ck)
        this.spots.push({ key: ck, x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5, label: 'Stash', tagText: `§6Stash §f(${count}+ storage)` })
        if (this.s['locator-bar']) this.c.waypoint(`${this.name}:${ck}|`, { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 }, { color: 0xffffaa00 })
        if (this.s['name-tag']) this.c.label(`${this.name}:${ck}`, { x: b.x + 0.5, y: b.y + 1.6, z: b.z + 0.5 }, `§6Stash §f(${count}+ storage)`)
        const msg = `Stash: ${count}+ storage blocks in chunk near ${b.x}, ${b.y}, ${b.z}`
        this.c.alert(this.s.alert, `§6${msg}`)
        this.c.hook(this, msg)
        if (this.s.disconnect) setTimeout(() => this.c.disconnect('[Glazed] ' + msg), 300)
      }
    }
  },

  blockEsp({
    name: 'block-notifier',
    color: 0xff55ffff,
    description: 'Alerts when chosen block entities are found',
    extraSettings: { blocks: { type: 'list', default: ['Beacon', 'EnchantTable', 'Conduit'], desc: 'Block entity ids (Beacon, Chest, Bell...)' } },
    match (b) { return this.s.blocks.map(x => x.toLowerCase()).includes(String(b.id).toLowerCase()) },
    tag: b => `§b${b.id}`
  }),

  blockEsp({
    name: 'beehive-esp',
    color: 0xffffcc33,
    description: 'Tags beehives and bee nests with how many bees are inside',
    extraSettings: { 'min-bees': { type: 'int', default: 0, desc: 'Only tag hives with at least this many bees' } },
    match (b) { return b.id === 'Beehive' && (b.Occupants?.length || 0) >= this.s['min-bees'] },
    tag: b => `§6Hive §f(${b.Occupants?.length || 0} bees)`
  }),

  blockEsp({
    name: 'collectible-esp',
    color: 0xffff55ff,
    description: 'Highlights item frames and banners',
    extraSettings: { 'item-frames': { type: 'bool', default: true, desc: 'Item frames' }, banners: { type: 'bool', default: true, desc: 'Banners' } },
    match (b) { return ((b.id === 'ItemFrame' || b.id === 'GlowItemFrame') && this.s['item-frames']) || (b.id === 'Banner' && this.s.banners) },
    tag: b => (b.id === 'Banner' ? '§dBanner' : `§dFrame${b.Item?.Name ? ': ' + shortName(b.Item.Name) : ''}`)
  }),

  blockEsp({
    name: 'piston-esp',
    color: 0xffaaaaaa,
    description: 'Tags pistons and sticky pistons',
    match: idIs('PistonArm'),
    tag: b => (b.Sticky ? '§aSticky piston' : '§7Piston')
  }),

  entityEsp({ name: 'llama-esp', description: 'Finds llamas and trader llamas', types: ['minecraft:llama', 'minecraft:trader_llama'], tag: '§eLlama', color: 0xffffff55 }),
  entityEsp({ name: 'pillager-esp', description: 'Finds pillagers', types: ['minecraft:pillager'], tag: '§cPillager', color: 0xffaa0000 }),
  entityEsp({ name: 'villager-esp', description: 'Finds villagers and zombie villagers', types: ['minecraft:villager_v2', 'minecraft:villager', 'minecraft:zombie_villager_v2', 'minecraft:zombie_villager'], tag: '§aVillager', color: 0xff55ff55 }),
  entityEsp({ name: 'wandering-esp', description: 'Finds wandering traders', types: ['minecraft:wandering_trader'], tag: '§9Wandering trader', color: 0xff5555ff }),
  entityEsp({
    name: 'drowned-trident-esp',
    color: 0xff00aaaa,
    description: 'Finds drowned holding tridents',
    types: ['minecraft:drowned'],
    tag: '§bTrident drowned',
    needsEquipment: item => item === 'minecraft:trident'
  }),

  {
    name: 'player-esp',
    category: CAT,
    description: 'Red name tag with distance on every player, visible through walls',
    settings: {
      alert: alertSetting,
      'show-distance': { type: 'bool', default: true, desc: 'Add the distance to the tag' },
      ...tracerSettings
    },
    tag (e) {
      const d = Math.round(Math.hypot(e.pos.x - this.c.self.pos.x, e.pos.y - 1.62 - this.c.self.pos.y, e.pos.z - this.c.self.pos.z))
      return `§c${e.username}${this.s['show-distance'] ? ` §7[${d}m]` : ''}`
    },
    others () { return [...this.c.entities].filter(([, e]) => e.type === 'minecraft:player' && e.username && e.username !== this.c.self.name) },
    onEnable () { this.alerted = new Set(); this.sent = new Map(); this.last = 0; for (const [rid, e] of this.others()) partialNametag(this.c, rid, this.tag(e)) },
    // Give players their normal tag back.
    onDisable () { for (const [rid, e] of this.others()) partialNametag(this.c, rid, e.username) },
    clientbound (pkt, p) {
      if (pkt === 'add_player' && p.username && p.username !== this.c.self.name) {
        const e = this.c.entities.get(key(p.runtime_id))
        if (e) Core.patchMetadata(p.metadata, { nametag: this.tag(e) })
        if (!this.alerted.has(p.username)) {
          this.alerted.add(p.username)
          this.c.alert(this.s.alert, `§cPlayer in view: §f${p.username} §7(${Math.round(Math.hypot(p.position.x - this.c.self.pos.x, p.position.z - this.c.self.pos.z))}m)`)
        }
      } else if (pkt === 'set_entity_data') {
        const e = this.c.entities.get(key(p.runtime_entity_id))
        if (e?.type === 'minecraft:player' && e.username !== this.c.self.name && p.metadata.some(m => m.key === 'nametag')) Core.patchMetadata(p.metadata, { nametag: this.tag(e) })
      }
    },
    onTick () {
      drawTracers(this, this.others().map(([, e]) => ({ x: e.pos.x, y: e.pos.y - 0.6, z: e.pos.z, label: e.username })))
      if (Date.now() - this.last < 500) return
      this.last = Date.now()
      this.sent ||= new Map()
      for (const [rid, e] of this.others()) {
        const t = this.tag(e)
        if (this.sent.get(rid) === t) continue
        this.sent.set(rid, t)
        partialNametag(this.c, rid, t)
      }
    }
  },

  {
    name: 'invis-esp',
    category: CAT,
    description: 'Makes invisible players and mobs visible',
    settings: { players: { type: 'bool', default: true, desc: 'Reveal players' }, mobs: { type: 'bool', default: true, desc: 'Reveal mobs' } },
    wants (e) { return e?.type === 'minecraft:player' ? this.s.players : this.s.mobs },
    // Entities that were already invisible before this was switched on.
    onEnable () {
      for (const [rid, e] of this.c.entities) {
        if (!e.flags?.invisible || !this.wants(e)) continue
        const md = [{ key: 'flags', value: { ...e.flags } }]
        Core.patchMetadata(md, { reveal: true })
        this.c.sendFlags(rid, md[0].value)
      }
    },
    onDisable () {
      for (const [rid, e] of this.c.entities) if (e.flags?.invisible && this.wants(e)) this.c.sendFlags(rid, e.flags)
    },
    clientbound (pkt, p) {
      if (pkt === 'add_player' && this.s.players) Core.patchMetadata(p.metadata, { reveal: true })
      else if (pkt === 'add_entity' && this.s.mobs) Core.patchMetadata(p.metadata, { reveal: true })
      else if (pkt === 'set_entity_data') {
        const e = this.c.entities.get(key(p.runtime_entity_id))
        const isPlayer = e?.type === 'minecraft:player'
        if ((isPlayer && this.s.players) || (!isPlayer && this.s.mobs)) Core.patchMetadata(p.metadata, { reveal: true })
      }
    }
  },

  {
    name: 'region-map',
    category: CAT,
    description: 'Shows your DonutSMP region above the hotbar',
    onTick () {
      if (Date.now() - (this.last || 0) < 1000) return
      this.last = Date.now()
      const { x, z } = this.c.self.pos
      const r = regionAt(x, z)
      this.c.actionbar(r < 0 ? '§7Outside the region map' : `§bRegion ${r} §7· §f${continent(r)}`, true)
    }
  }
]
