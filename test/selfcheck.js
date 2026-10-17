// Offline self-check: module logic plus a round trip of every packet the client builds through the real protocol encoder.
const assert = require('assert')
const os = require('os')
const path = require('path')
const nbt = require('prismarine-nbt')
const { createSerializer, createDeserializer } = require('bedrock-protocol/src/transforms/serializer')
const { CURRENT_VERSION } = require('bedrock-protocol/src/options')
const { Core } = require('../src/core')
const { handleCommand, loadModules } = require('../src/index')
const gui = require('../src/gui')
const { regionAt, continent } = require('../src/regions')
const { parseAmount } = require('../src/util')
const { blockEntitiesFromLevelChunk, blockEntitiesFromSubChunk } = require('../src/chunk')

const ser = createSerializer(CURRENT_VERSION)
const des = createDeserializer(CURRENT_VERSION)

// --- pure helpers
assert.strictEqual(regionAt(-57501, 130197), 28)
assert.strictEqual(continent(28), 'EU Central')
assert.strictEqual(regionAt(1e7, 0), -1)
assert.strictEqual(parseAmount('10k'), 10000)
assert.strictEqual(parseAmount('1.5m'), 1500000)
assert.ok(Number.isNaN(parseAmount('abc')))

// --- chunk block entities
function varint (n) { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x) } while (n); return Buffer.from(b) }
const spawnerNbt = nbt.writeUncompressed({ type: 'compound', name: '', value: { id: { type: 'string', value: 'MobSpawner' }, x: { type: 'int', value: 100 }, y: { type: 'int', value: -20 }, z: { type: 'int', value: -300 }, EntityIdentifier: { type: 'string', value: 'minecraft:zombie' } } }, 'littleVarint')
const chestNbt = nbt.writeUncompressed({ type: 'compound', name: '', value: { id: { type: 'string', value: 'Chest' }, x: { type: 'int', value: 1 }, y: { type: 'int', value: 2 }, z: { type: 'int', value: 3 } } }, 'littleVarint')
const singleSub = Buffer.concat([Buffer.from([9, 1, 0, 0x01]), varint(0)]) // v9, 1 layer, y=0, bits=0, one id
const fourBitSub = Buffer.concat([Buffer.from([9, 1, 1, (4 << 1) | 1]), Buffer.alloc(2048), varint(4), varint(10), varint(20)]) // palette of 2 (zigzag 4)
const biomes = Buffer.concat([Buffer.from([0x01]), varint(2), Buffer.alloc(23, 0xff)])
const payload = Buffer.concat([singleSub, fourBitSub, biomes, Buffer.from([0]), spawnerNbt, chestNbt])
const bes = blockEntitiesFromLevelChunk(payload, 2)
assert.deepStrictEqual(bes.map(b => b.id), ['MobSpawner', 'Chest'])
assert.strictEqual(bes[0].EntityIdentifier, 'minecraft:zombie')
assert.strictEqual(bes[0].y, -20)
assert.deepStrictEqual(blockEntitiesFromLevelChunk(Buffer.concat([singleSub, biomes, Buffer.from([0])]), 1), [])
assert.strictEqual(blockEntitiesFromSubChunk(Buffer.concat([singleSub, chestNbt]))[0].id, 'Chest')
// nether: 8 biome sections
const netherBiomes = Buffer.concat([Buffer.from([0x01]), varint(2), Buffer.alloc(7, 0xff)])
assert.strictEqual(blockEntitiesFromLevelChunk(Buffer.concat([singleSub, netherBiomes, Buffer.from([0]), spawnerNbt]), 1)[0].id, 'MobSpawner')

// --- passthrough: untouched packets go out as the original bytes
const { decide } = require('../src/passthrough')
const noop = () => {}
assert.strictEqual(decide('clientbound', 'text', { message: 'hi' }, { canceled: false }, noop), 'raw')
assert.strictEqual(decide('clientbound', 'text', { message: 'hi' }, { canceled: false }, (n, p) => { p.message = 'cut' }), 're-encode')
assert.strictEqual(decide('clientbound', 'add_entity', { runtime_id: 5n }, { canceled: false }, (n, p, d) => { d.canceled = true }), 'drop')
assert.strictEqual(decide('clientbound', 'level_chunk', { payload: Buffer.from([1]) }, { canceled: false }, noop), 'raw')
assert.strictEqual(decide('serverbound', 'inventory_transaction', { a: { b: 1 } }, { canceled: false }, (n, p) => { p.a.b = 2 }), 're-encode')

// --- core with a fake connection that records every packet
const sentClient = []
const sentServer = []
const config = { prefix: '.', modules: {}, server: { host: 'donutsmp.net', port: 19132 } }
const core = new Core(config, path.join(os.tmpdir(), 'glazed-selfcheck-config.json'))
loadModules(core)
core.player = { profile: { name: 'Me', uuid: '11111111-2222-3333-4444-555555555555' }, queue: (name, params) => sentClient.push({ name, params }), upstream: { queue: (name, params) => sentServer.push({ name, params }) }, disconnect: r => { core.disconnected = r } }
const fakeDes = () => ({ canceled: false })
const clientbound = (name, params) => { const d = fakeDes(); core.onClientbound(name, params, d); return d.canceled }
const serverbound = (name, params) => { const d = fakeDes(); core.onServerbound(name, params, d); return d.canceled }
const mod = n => core.modules.get(n)

clientbound('start_game', { runtime_entity_id: 1n, entity_id: 1n, player_position: { x: 10, y: 70, z: 10 }, dimension: 'overworld' })
clientbound('item_registry', { itemstates: [{ name: 'minecraft:ender_pearl', runtime_id: 5 }, { name: 'minecraft:trident', runtime_id: 6 }, { name: 'minecraft:diamond', runtime_id: 7 }] })
const item = id => ({ network_id: id, count: 1, metadata: 0, has_stack_id: false, block_runtime_id: 0, extra: {} })
clientbound('inventory_content', { window_id: 'inventory', input: [item(7), item(0), item(7)] })
assert.deepStrictEqual(core.hotbar().slice(0, 3), ['minecraft:diamond', null, 'minecraft:diamond'])

// commands & settings
handleCommand(core, 'set rtper distance 5k')
assert.strictEqual(mod('rtper').s.distance, '5k')
handleCommand(core, 'set playerdetection whitelist Steve, Alex')
assert.deepStrictEqual(mod('player-detection').s.whitelist, ['Steve', 'Alex'])
assert.throws(() => handleCommand(core, 'set rtper rtp-region mars'))
handleCommand(core, 'help')
handleCommand(core, 'list')
handleCommand(core, 'get rtper')

// ".t <module> on/off" sets the state instead of flipping it
handleCommand(core, 't rain-noti on'); handleCommand(core, 't rain-noti true')
assert.strictEqual(mod('rain-noti').enabled, true)
handleCommand(core, 't rain-noti off'); handleCommand(core, 't rain-noti false')
assert.strictEqual(mod('rain-noti').enabled, false)

// every module toggles on and off without throwing
for (const m of core.modules.values()) {
  if (m.oneShot) continue
  core.setEnabled(m, true)
  core.setEnabled(m, false)
}

// fake pay swallows /pay
core.setEnabled(mod('fake-pay'), true)
assert.strictEqual(serverbound('command_request', { command: '/pay Bob 5000', origin: { type: 'player', uuid: '11111111-2222-3333-4444-555555555555', request_id: '', player_entity_id: 0n }, internal: false, version: '1' }), true)
assert.ok(sentClient.some(p => p.name === 'text' && p.params.message.includes('You paid')))
assert.strictEqual(serverbound('command_request', { command: '/home', origin: core.commandTemplate.origin, internal: false, version: '1' }), false)

// no-block-interact rewrites pearl clicks on blocks
core.setEnabled(mod('no-block-interact'), true)
const tx = { transaction: { transaction_type: 'item_use', transaction_data: { action_type: 'click_block', held_item: item(5), block_position: { x: 1, y: 2, z: 3 }, face: 1 } } }
serverbound('inventory_transaction', tx)
assert.strictEqual(tx.transaction.transaction_data.action_type, 'click_air')

// player detection (alerts go above the hotbar by default, possibly still queued)
const shown = s => sentClient.some(p => (p.name === 'text' && p.params.message.includes(s)) || (p.name === 'set_title' && p.params.text.includes(s))) || (core.alertQueue || []).some(a => a.msg.includes(s))
core.setEnabled(mod('player-detection'), true)
handleCommand(core, 'set player-detection disconnect true')
clientbound('add_player', { username: 'Griefer', runtime_id: 50n, unique_id: 50n, position: { x: 20, y: 70, z: 20 }, metadata: [] })
assert.ok(shown('Griefer'))
clientbound('add_player', { username: 'Steve', runtime_id: 51n, unique_id: 51n, position: { x: 20, y: 70, z: 20 }, metadata: [] })
assert.ok(!shown('detected: §fSteve'))

// entity ESP tags matching mobs in place; invis ESP removes invisibility
core.setEnabled(mod('llama-esp'), true)
core.setEnabled(mod('invis-esp'), true)
const llama = { unique_id: 60n, runtime_id: 60n, entity_type: 'minecraft:llama', position: { x: 0, y: 64, z: 0 }, metadata: [{ key: 'flags', type: 'long', legacy_type: 7, value: { _value: 1n << 5n, invisible: true } }] }
clientbound('add_entity', llama)
assert.strictEqual(llama.metadata.find(m => m.key === 'nametag').value, '§eLlama')
assert.strictEqual(llama.metadata[0].value.invisible, false)
assert.strictEqual(llama.metadata[0].value._value & (1n << 5n), 0n)

// block ESPs label spawners and stashes
core.setEnabled(mod('spawner-notifier'), true)
core.setEnabled(mod('advanced-stash-finder'), true)
handleCommand(core, 'set advanced-stash-finder min-storage 2')
const chest = (x) => nbt.writeUncompressed({ type: 'compound', name: '', value: { id: { type: 'string', value: 'Chest' }, x: { type: 'int', value: x }, y: { type: 'int', value: 5 }, z: { type: 'int', value: 5 } } }, 'littleVarint')
clientbound('level_chunk', { x: 0, z: 0, sub_chunk_count: 1, cache_enabled: false, payload: Buffer.concat([singleSub, biomes, Buffer.from([0]), spawnerNbt, chest(1), chest(2)]) })
assert.ok(core.labels.has('spawner-notifier:100,-20,-300'))
assert.ok(core.labels.has('advanced-stash-finder:0,0'))
// a block ESP switched on after the chunk loaded still finds what was in it
core.setEnabled(mod('block-notifier'), true)
handleCommand(core, 'set block-notifier blocks MobSpawner')
core.setEnabled(mod('block-notifier'), false)
core.setEnabled(mod('block-notifier'), true)
assert.ok(core.labels.has('block-notifier:100,-20,-300'), 'replayed from remembered chunk data')
// changing a tag's text swaps in a new tag, then removes the old one (the game ignores in-place text updates)
const oldTag = core.labels.get('block-notifier:100,-20,-300')
assert.strictEqual(core.relabel('block-notifier:100,-20,-300', 'too soon'), false, 'a brand-new tag is left to settle')
core.labelBorn.set('block-notifier:100,-20,-300', 0)
assert.ok(core.relabel('block-notifier:100,-20,-300', 'spawner [9m]'))
const swapAdd = sentClient.at(-1)
assert.strictEqual(swapAdd.name, 'add_entity')
assert.strictEqual(swapAdd.params.metadata.find(m => m.key === 'nametag').value, 'spawner [9m]')
assert.notStrictEqual(core.labels.get('block-notifier:100,-20,-300'), oldTag)
setTimeout(() => assert.ok(sentClient.some(p => p.name === 'remove_entity' && p.params.entity_id_self === oldTag), 'old tag removed a moment later'), 400)
// a real 1.26.52 sub-chunk payload layout: v9 storage then block entity NBT
const realSub = Buffer.concat([singleSub, spawnerNbt, chestNbt])
clientbound('subchunk', { cache_enabled: false, entries: [{ result: 'success', payload: realSub }, { result: 'success_all_air' }] })
assert.ok(core.blockEntities.has('1,2,3'))

// tracers: particle dots from the player toward each found target, only when switched on
core.setEnabled(mod('pillager-esp'), true)
clientbound('add_entity', { unique_id: 80n, runtime_id: 80n, entity_type: 'minecraft:pillager', position: { x: 25, y: 70, z: 10 }, velocity: { x: 0, y: 0, z: 0 }, metadata: [] })
handleCommand(core, 'set pillager-esp waypoint off') // its beam is particles too
const dotsBefore = sentClient.filter(p => p.name === 'spawn_particle_effect').length
mod('pillager-esp').onTick()
assert.strictEqual(sentClient.filter(p => p.name === 'spawn_particle_effect').length, dotsBefore, 'no tracers while off')
handleCommand(core, 'set pillager-esp tracers on')
mod('pillager-esp').onTick()
const dots = sentClient.filter(p => p.name === 'spawn_particle_effect').slice(dotsBefore)
assert.strictEqual(dots.length, 24, `tracer dots: ${dots.length}`)
assert.ok(dots.every(p => p.params.position.x > 10 && p.params.position.x <= 25.0001), 'dots lie between player and target')
assert.ok(Math.abs(dots.at(-1).params.position.x - 25) < 0.01, 'line reaches the target')

// in-world waypoint on a mob: a particle beam (its tag was set in the spawn packet and can't change later)
handleCommand(core, 'set pillager-esp tracers off')
handleCommand(core, 'set pillager-esp waypoint on')
mod('pillager-esp')._waypointAt = 0
const beamBefore = sentClient.filter(p => p.name === 'spawn_particle_effect').length
const entityDataBefore = sentClient.filter(p => p.name === 'set_entity_data').length
mod('pillager-esp').onTick()
assert.strictEqual(sentClient.filter(p => p.name === 'set_entity_data').length, entityDataBefore, 'no ignored in-place tag updates sent')
// a server update for that mob keeps our tag on it
const serverUpdate = { runtime_entity_id: 80n, metadata: [{ key: 'flags', type: 'long', legacy_type: 7, value: { _value: 0n } }], properties: { ints: [], floats: [] }, tick: 5001n }
clientbound('set_entity_data', serverUpdate)
assert.strictEqual(serverUpdate.metadata.find(m => m.key === 'nametag').value, '§cPillager')
core.beamAt = 0
core.renderBeams()
assert.ok(sentClient.filter(p => p.name === 'spawn_particle_effect').length - beamBefore >= 10, 'beam particles')

// Locator Bar dots (opt-in): tied to the mob; turning the module off removes them
assert.strictEqual(core.countWaypoints('pillager-esp:'), 0, 'off by default')
handleCommand(core, 'set pillager-esp locator-bar on')
const wpBefore = sentClient.filter(p => p.name === 'locator_bar').length
clientbound('add_entity', { unique_id: 81n, runtime_id: 81n, entity_type: 'minecraft:pillager', position: { x: 30, y: 70, z: 10 }, velocity: { x: 0, y: 0, z: 0 }, metadata: [] })
const added = sentClient.filter(p => p.name === 'locator_bar').slice(wpBefore).map(p => p.params.waypoints[0])
assert.ok(added.some(w => w.action === 'add' && String(w.waypoint.actor_unique_id) === '81' && w.waypoint.client_position_authority), 'mob waypoint follows the mob')
core.setEnabled(mod('pillager-esp'), false)
assert.ok(sentClient.filter(p => p.name === 'locator_bar').at(-1).params.waypoints.every(w => w.action === 'remove'), 'waypoints removed on disable')
assert.strictEqual(core.countWaypoints('pillager-esp:'), 0)

// tracer arrow points relative to where you look (yaw 0 = south, 90 = west, -90 = east)
const me = (x, z, yaw) => ({ pos: { x, y: 64, z }, look: { yaw } })
assert.strictEqual(Core.arrow(me(0, 0, 0), { x: 0, z: 10 }), '↑', 'facing south, target south')
assert.strictEqual(Core.arrow(me(0, 0, 0), { x: -10, z: 0 }), '→', 'facing south, target west is to the right')
assert.strictEqual(Core.arrow(me(0, 0, 0), { x: 10, z: 0 }), '←', 'facing south, target east is to the left')
assert.strictEqual(Core.arrow(me(0, 0, 180), { x: 0, z: 10 }), '↓', 'facing north, target behind')
assert.strictEqual(Core.arrow(me(0, 0, -90), { x: 10, z: 10 }), '↗', 'facing east, target south-east is ahead-right')
Object.assign(core, { alertUntil: 0, hudAt: 0 })
core.offerHudTarget({ x: 25, y: 70, z: 10, d: 15, label: 'Pillager' })
core.renderHud()
assert.match(sentClient.filter(p => p.name === 'set_title').at(-1).params.text, /Pillager .*15m/)

// alerts: small, queued above the hotbar by default; background HUD text waits
clearTimeout(core.alertTimer)
Object.assign(core, { alertQueue: [], alertTimer: null, alertUntil: 0 })
const beforeAlert = sentClient.length
core.alert('actionbar', 'first')
core.alert('actionbar', 'second')
const bars = sentClient.slice(beforeAlert).filter(p => p.name === 'set_title')
assert.deepStrictEqual(bars.map(p => p.params.text), ['first'], 'second alert waits its turn')
core.actionbar('region text', true)
assert.strictEqual(sentClient.filter(p => p.name === 'set_title').at(-1).params.text, 'first', 'background text held back')

// freecam: game gets flight + no-clip, server keeps hearing "standing still", off puts you back
const ability = flags => ({ _value: 0, build: true, mine: true, ...flags })
clientbound('update_abilities', { entity_unique_id: 1n, permission_level: 'member', command_permission: 'normal', abilities: [{ type: 'base', allowed: ability({}), enabled: ability({}), fly_speed: 0.05, vertical_fly_speed: 1, walk_speed: 0.1 }] })
const authInput = (x, flags = []) => ({
  pitch: 5, yaw: 90, position: { x, y: 71.62, z: 10 }, move_vector: { x: 0, z: 1 }, head_yaw: 90, input_data: flags,
  input_mode: 'mouse', play_mode: 'normal', interaction_model: 'crosshair', interact_rotation: { x: 5, z: 90 }, tick: 100n,
  delta: { x: 0.2, y: 0, z: 0 }, transaction: undefined, item_stack_request: undefined, block_action: undefined,
  vehicle_rotation: undefined, predicted_vehicle: undefined, analogue_move_vector: { x: 0, z: 1 }, camera_orientation: { x: 0, y: 0, z: 1 }, raw_move_vector: { x: 0, z: 1 }
})
serverbound('player_auth_input', authInput(10))
const fc = mod('glazed-freecam')
core.setEnabled(fc, true)
const grant = [...sentClient].reverse().find(p => p.name === 'update_abilities').params.abilities[0].enabled
assert.ok(grant.flying && grant.may_fly && grant.no_clip, 'flight + no-clip (underground) granted')
assert.strictEqual(serverbound('request_ability', { ability: 'flying', value_type: 'bool', bool_value: true, float_val: 0 }), true, 'fly request never reaches the server')
const moving = authInput(30, ['up', 'sprinting', 'jumping', 'received_server_data'])
serverbound('player_auth_input', moving)
assert.strictEqual(moving.position.x, 10, 'server still sees the body')
assert.deepStrictEqual(moving.input_data, ['received_server_data'])
assert.strictEqual(serverbound('inventory_transaction', { transaction: { transaction_type: 'item_use', transaction_data: { action_type: 'click_block', held_item: item(7) } } }), true, 'actions held back')
assert.strictEqual(clientbound('correct_player_move_prediction', {}), true, 'no snap-back while flying')
core.setEnabled(fc, false)
const back = sentClient.filter(p => p.name === 'move_player').at(-1)
assert.strictEqual(back.params.position.x, 10, 'returned to the body')
sentServer.push({ name: 'player_auth_input', params: moving }) // the rewritten packet must still encode

// performance
core.setEnabled(mod('no-particles'), true)
assert.strictEqual(clientbound('spawn_particle_effect', {}), true)
assert.strictEqual(clientbound('level_event', { event: 'particle_explosion' }), true)
assert.strictEqual(clientbound('level_event', { event: 'start_rain' }), false)
core.setEnabled(mod('chunk-limiter'), true)
const req = { chunk_radius: 24, max_radius: 24 }
serverbound('request_chunk_radius', req)
assert.strictEqual(req.chunk_radius, 8)

// other module actions that send packets
core.setEnabled(mod('fake-scoreboard'), true)
const fakeScores = sentClient.filter(p => p.name === 'set_score').at(-1).params.entries
assert.ok(fakeScores.every(e => e.entry_type === 'fake_player' && e.entry_type_name === 'changefakeplayer'), 'score lines match the real server shape')
core.setEnabled(mod('no-weather'), true)
core.setEnabled(mod('ah-sell'), true)
core.setEnabled(mod('home-reset'), true)
core.setEnabled(mod('region-map'), true)
core.setEnabled(mod('admin-hud'), true)
core.emit('onTick')
assert.ok(sentClient.some(p => p.name === 'player_hotbar'))
assert.ok(sentServer.some(p => p.name === 'command_request' && p.params.command === '/delhome 1'))

// anti-exploit: malicious packets get dropped or defused, normal ones pass
const ax = mod('anti-exploit')
assert.strictEqual(ax.defaultEnabled, true)
core.setEnabled(ax, true)
assert.strictEqual(clientbound('modal_form_request', { form_id: 1, data: 'x'.repeat(100000) }), true, 'oversized form')
assert.strictEqual(clientbound('modal_form_request', { form_id: 2, data: '{}' }), false)
clientbound('modal_form_request', { form_id: 3, data: '{}' })
clientbound('modal_form_request', { form_id: 4, data: '{}' })
assert.strictEqual(clientbound('modal_form_request', { form_id: 5, data: '{}' }), true, 'form spam')
const bigText = { type: 'raw', message: 'A'.repeat(50000) }
assert.strictEqual(clientbound('text', bigText), false)
assert.ok(bigText.message.length < 1600, 'chat text cut')
const transl = { type: 'translation', message: 'x', parameters: Array(500).fill('%1') }
assert.strictEqual(clientbound('text', transl), true, 'translation bomb')
let dropped = 0
for (let i = 0; i < 1000; i++) if (clientbound('spawn_particle_effect', { position: { x: 0, y: 0, z: 0 } })) dropped++
assert.ok(dropped >= 700, 'particle flood limited')
dropped = 0
for (let i = 0; i < 200; i++) if (clientbound('play_sound', { name: 'a' })) dropped++
assert.ok(dropped >= 140, 'sound flood limited')
assert.strictEqual(clientbound('move_entity', { runtime_entity_id: 60n, position: { x: NaN, y: 0, z: 0 } }), true, 'NaN position')
assert.strictEqual(clientbound('move_player', { runtime_id: 1n, position: { x: 1e9, y: 0, z: 0 } }), true, 'far position')
assert.strictEqual(clientbound('move_entity_delta', { runtime_entity_id: 60n, x: Infinity }), true, 'infinite delta')
assert.strictEqual(clientbound('set_entity_motion', { runtime_entity_id: 60n, velocity: { x: 1e6, y: 0, z: 0 } }), true, 'extreme velocity on mob')
const selfLaunch = { runtime_entity_id: 1n, velocity: { x: 300, y: 400, z: 0 } }
assert.strictEqual(clientbound('set_entity_motion', selfLaunch), false)
assert.ok(Math.abs(Math.hypot(selfLaunch.velocity.x, selfLaunch.velocity.y) - 60) < 1e-6, 'own knockback scaled to limit')
const tagBomb = { unique_id: 70n, runtime_id: 70n, entity_type: 'minecraft:zombie', position: { x: 0, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, metadata: [{ key: 'nametag', type: 'string', legacy_type: 4, value: 'W'.repeat(100000) }] }
assert.strictEqual(clientbound('add_entity', tagBomb), false)
assert.ok(tagBomb.metadata[0].value.length < 210, 'nametag cut')
assert.strictEqual(clientbound('move_entity', { runtime_entity_id: 60n, position: { x: 5, y: 64, z: 5 } }), false, 'normal move passes')
handleCommand(core, 'set anti-exploit block-transfer true')
assert.strictEqual(clientbound('transfer', { server_address: 'evil.example', port: 19132 }), true)
ax.lastReport = 0
core.emit('onTick')
assert.ok(shown('Blocked:'), 'blocked summary shown')

// .exploittest: with protection on nothing harmful gets through; with it off everything does (and still encodes)
const lastChat = () => [...sentClient].reverse().find(p => p.name === 'text' && p.params.message.includes('Exploit test done')).params.message
handleCommand(core, 'exploittest')
assert.ok(/§a\d+§f blocked or defused, §c[0-3]§f reached/.test(lastChat()), lastChat())
core.setEnabled(ax, false)
core.setEnabled(mod('no-particles'), false)
handleCommand(core, 'exploittest')
assert.ok(/§a0§f blocked or defused/.test(lastChat()), lastChat())
core.setEnabled(ax, true)

// commands from modules are spaced out
const before = sentServer.filter(p => p.name === 'command_request').length
core.command('a'); core.command('b'); core.command('c')
assert.strictEqual(sentServer.filter(p => p.name === 'command_request').length - before <= 1, true, 'throttled')

// GUI round trip: menu -> category panel (flip the first module, pick its settings) -> settings -> submit unchanged
gui.openMain(core)
const lastForm = () => [...sentClient].reverse().find(p => p.name === 'modal_form_request').params
const answer = data => { const fm = lastForm(); assert.ok(gui.handleResponse(core, { form_id: fm.form_id, has_response_data: true, data: JSON.stringify(data) })) }
let f = lastForm()
assert.strictEqual(JSON.parse(f.data).buttons.length, gui.categoryCount(core) + 3)
answer(0) // first category
const panel = JSON.parse(lastForm().data)
assert.strictEqual(panel.type, 'custom_form')
const firstMod = [...core.modules.values()][0]
const wasOn = firstMod.enabled
const toggles = panel.content.filter(e => e.type === 'toggle').map(e => e.default)
toggles[0] = !wasOn
answer([...toggles, 1]) // flip the first module, open settings for the first one that has settings
assert.strictEqual(firstMod.enabled, !wasOn, 'toggle applied from the panel')
f = lastForm()
const form = JSON.parse(f.data)
assert.strictEqual(form.type, 'custom_form')
const answers = form.content.map(e => (e.type === 'dropdown' ? e.default : e.default))
assert.ok(gui.handleResponse(core, { form_id: f.form_id, has_response_data: true, data: JSON.stringify(answers) }))
assert.ok(!gui.handleResponse(core, { form_id: 12345, has_response_data: false }))

// double-tap sneak opens the menu
const formsBefore = sentClient.filter(p => p.name === 'modal_form_request').length
core.setEnabled(mod('click-gui'), true)
serverbound('player_auth_input', authInput(10, ['start_sneaking']))
serverbound('player_auth_input', authInput(10, ['start_sneaking']))
assert.strictEqual(sentClient.filter(p => p.name === 'modal_form_request').length, formsBefore + 1, 'double sneak opens the GUI')
handleCommand(core, 'set click-gui bind emote')
assert.strictEqual(serverbound('emote', { entity_id: 1n, emote_id: 'x', emote_length_ticks: 20, xuid: '', platform_id: '', flags: 'server_side' }), true, 'emote swallowed')
assert.strictEqual(sentClient.filter(p => p.name === 'modal_form_request').length, formsBefore + 2, 'emote opens the GUI')
handleCommand(core, 'set click-gui bind double-sneak')

// fullbright: client-only night vision, kept even if the server tries to remove it
core.setEnabled(mod('fullbright'), true)
const nv = sentClient.filter(p => p.name === 'mob_effect').at(-1).params
assert.deepStrictEqual([nv.event_id, nv.effect_id], ['add', 16])
assert.strictEqual(clientbound('mob_effect', { runtime_entity_id: 1n, event_id: 'remove', effect_id: 16 }), true)
core.setEnabled(mod('fullbright'), false)

// nametags: a floating tag over other players with name + distance
core.setEnabled(mod('nametags'), true)
mod('nametags').last = 0
mod('nametags').onTick()
assert.ok([...core.labels.keys()].some(k => k.startsWith('nametags:')), 'tag created for a visible player')
const drop = { entity_id_self: 90n, runtime_entity_id: 90n, item: { ...item(7), count: 3 }, position: { x: 12, y: 70, z: 10 }, velocity: { x: 0, y: 0, z: 0 }, metadata: [], is_from_fishing: false }
clientbound('add_item_entity', drop)
mod('nametags').last = 0
mod('nametags').onTick()
assert.ok(core.labels.has('nametags:item:90|'), 'dropped item gets a floating tag')
clientbound('take_item_entity', { runtime_entity_id: 90n, target: 1 })
assert.ok(!core.labels.has('nametags:item:90|'), 'tag goes when the item is picked up')
core.setEnabled(mod('nametags'), false)
assert.ok(![...core.labels.keys()].some(k => k.startsWith('nametags:')), 'tags removed on disable')

// emote binds: .bind then an emote binds it; that emote then toggles the module and never reaches the server
const emote = id => ({ entity_id: 1n, emote_id: id, emote_length_ticks: 20, xuid: '', platform_id: '', flags: 'server_side' })
const rn = mod('rain-noti')
core.setEnabled(rn, false)
handleCommand(core, 'bind rain-noti')
assert.strictEqual(serverbound('emote', emote('wave-id')), true, 'binding emote swallowed')
assert.strictEqual(config.binds['wave-id'], 'rain-noti')
assert.strictEqual(serverbound('emote', emote('wave-id')), true)
assert.strictEqual(rn.enabled, true, 'bound emote toggles the module')
assert.strictEqual(serverbound('emote', emote('other-id')), false, 'unbound emotes play normally')
handleCommand(core, 'unbind rain-noti')
assert.strictEqual(config.binds['wave-id'], undefined)
// a Click GUI bind opens the menu; it must not switch Click GUI (and its double-sneak bind) off
const clickGui = mod('click-gui')
const bindMenusBefore = sentClient.filter(p => p.name === 'modal_form_request').length
handleCommand(core, 'bind click-gui')
serverbound('emote', emote('menu-id'))
assert.strictEqual(serverbound('emote', emote('menu-id')), true)
assert.strictEqual(clickGui.enabled, true, 'click-gui stays on')
assert.ok(sentClient.filter(p => p.name === 'modal_form_request').length > bindMenusBefore, 'bound emote opens the menu')
handleCommand(core, 'unbind click-gui')

// changing the server: saved, and the live proxy destination follows
config.server = { host: 'donutsmp.net', port: 19132 }
core.destination = { host: 'donutsmp.net', port: 19132 }
handleCommand(core, 'server play.example.net 19133')
assert.deepStrictEqual(config.server, { host: 'play.example.net', port: 19133 })
assert.strictEqual(core.destination.host, 'play.example.net')
assert.throws(() => handleCommand(core, 'server bad/host'))
assert.throws(() => handleCommand(core, 'server ok.net 99999'))

// a form refused as "busy" (chat screen open) is sent again
gui.openMain(core)
f = lastForm()
assert.ok(gui.handleResponse(core, { form_id: f.form_id, has_response_data: false, has_cancel_reason: true, cancel_reason: 'busy' }))
setTimeout(() => assert.notStrictEqual(lastForm().form_id, f.form_id, 'busy form resent'), 600)

// client chat defaults to the server's player-chat shape; .chatformat switches it
core.info('hello')
assert.deepStrictEqual([sentClient.at(-1).params.type, sentClient.at(-1).params.category, sentClient.at(-1).params.source_name, sentClient.at(-1).params.message], ['chat', 'authored', '§dGlazed§r', 'hello'])
handleCommand(core, 'chatformat json')
assert.strictEqual(core.config.chatFormat, 'json')
core.info('hi')
assert.strictEqual(JSON.parse(sentClient.at(-1).params.message).rawtext[0].text, '§d[Glazed]§r hi')
assert.throws(() => handleCommand(core, 'chatformat nope'))

setTimeout(() => {
  // labels are sent after a short delay; turning the module off removes them
  core.setEnabled(mod('spawner-notifier'), false)
  assert.ok(!core.labels.has('spawner-notifier:100,-20,-300'))
  core.setEnabled(mod('llama-esp'), false)
  // the llama packet as patched in place by llama-esp + invis-esp must still encode
  const patchedLlama = { ...llama, velocity: { x: 0, y: 0, z: 0 }, pitch: 0, yaw: 0, head_yaw: 0, body_yaw: 0, attributes: [], properties: { ints: [], floats: [] }, links: [] }
  const all = [...sentClient, ...sentServer, { name: 'add_entity', params: patchedLlama }]
  const names = new Set()
  for (const p of all) {
    const buf = ser.createPacketBuffer(p)
    const back = des.parsePacketBuffer(buf)
    assert.strictEqual(back.data.name, p.name)
    names.add(p.name)
  }
  for (const n of ['text', 'set_title', 'play_sound', 'add_entity', 'remove_entity', 'set_display_objective', 'set_score', 'remove_objective', 'command_request', 'player_hotbar', 'request_chunk_radius', 'level_event', 'modal_form_request', 'transfer']) {
    assert.ok(names.has(n), 'never produced ' + n)
  }
  assert.ok(core.disconnected?.includes('Griefer'))
  assert.deepStrictEqual(sentClient.filter(p => p.name === 'transfer').at(-1).params, { server_address: '127.0.0.1', port: 19134, reload_world: true })
  console.log(`selfcheck ok: ${core.modules.size} modules, ${all.length} packets encoded (${[...names].join(', ')})`)
  process.exit(0)
}, 700)
