// Builds one of every ESP target around a player on the local test server (run tools/local-server.js so the bot gets op).
//   node tools/esp-test-zone.js [playerName]
const bp = require('bedrock-protocol')
const { CURRENT_VERSION } = require('bedrock-protocol/src/options')

const target = process.argv[2] || '@s'
const at = cmd => `/execute at ${target === '@s' ? '@s' : `"${target}"`} run ${cmd}`
const COMMANDS = [
  '/time set day',
  '/gamerule domobspawning false',
  // blocks: x+ row in front of the player
  'setblock ~3 ~ ~ mob_spawner',
  'fill ~5 ~ ~ ~7 ~ ~1 chest',
  'setblock ~3 ~ ~3 beehive',
  'setblock ~5 ~ ~3 standing_banner',
  'setblock ~7 ~ ~3 piston',
  'setblock ~8 ~ ~3 sticky_piston',
  'setblock ~3 ~ ~-3 beacon',
  // mobs: z- row
  'summon llama ~-3 ~ ~-4',
  'summon pillager ~-5 ~ ~-4',
  'summon villager ~-7 ~ ~-4',
  'summon wandering_trader ~-9 ~ ~-4',
  'summon drowned ~-11 ~ ~-4',
  'summon cow ~-13 ~ ~-4',
  '/replaceitem entity @e[type=drowned] slot.weapon.mainhand 0 trident',
  '/effect @e[type=cow] invisibility 9999 0 true',
  '/effect @e[type=drowned] fire_resistance 9999 0 true',
  '/effect @e[type=pillager] slowness 9999 255 true',
  '/effect @e[type=pillager] weakness 9999 255 true'
]

const client = bp.createClient({ host: '127.0.0.1', port: 19132, offline: true, username: 'ZoneBot', version: CURRENT_VERSION, transport: 'raknet', skipPing: true })
let origin
client.on('start_game', p => { origin = { type: 'player', uuid: '5a6b7c8d-1111-4222-8333-944455556666', request_id: '', player_entity_id: p.entity_id } })
client.on('command_output', p => { for (const o of p.output) console.log(o.success ? 'ok  ' : 'FAIL', o.message_id, o.parameters.join(' ')) })
client.on('kick', r => { console.log('kicked:', r.message); process.exit(1) })
client.on('spawn', () => {
  // wait for local-server.js to op us
  COMMANDS.forEach((c, i) => setTimeout(() => {
    const command = c.startsWith('/') ? c : at(c)
    console.log('>', command)
    client.queue('command_request', { command, origin, internal: false, version: 'latest' })
  }, 4000 + i * 400))
  setTimeout(() => { client.close(); process.exit(0) }, 4000 + COMMANDS.length * 400 + 2000)
})
