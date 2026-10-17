const fs = require('fs')
const path = require('path')
const { Relay } = require('bedrock-protocol')
const { CURRENT_VERSION } = require('bedrock-protocol/src/options')
const { Core } = require('./core')
const gui = require('./gui')
const passthrough = require('./passthrough')
const { regionAt, continent } = require('./regions')

const ROOT = path.join(__dirname, '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')
const DEFAULT_CONFIG = {
  proxy: { host: '127.0.0.1', port: 19134 },
  server: { host: 'donutsmp.net', port: 19132 },
  version: CURRENT_VERSION,
  prefix: '.',
  debug: false,
  modules: {}
}

function loadConfig () {
  if (!fs.existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_CONFIG)
  const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  return { ...DEFAULT_CONFIG, ...saved }
}

function loadModules (core) {
  // protection first, so other modules only ever see packets it has already cleaned
  for (const file of ['protection', 'main', 'esp', 'client', 'performance']) {
    for (const mod of require(`./modules/${file}`)) core.register(mod)
  }
}

function handleCommand (core, line) {
  const [cmd = '', ...args] = line.trim().split(/\s+/)
  const mod = args[0] && core.find(args[0])
  const need = () => { if (!mod) throw new Error(`no module "${args[0] || ''}" (try ${core.config.prefix}list)`) }
  switch (cmd.toLowerCase()) {
    case 'gui': case 'menu': case 'clickgui':
      return gui.openMain(core)
    case 't': case 'toggle': {
      need()
      // ".t freecam on/off/true/false" sets it; plain ".t freecam" flips it
      const want = { on: true, true: true, off: false, false: false }[String(args[1]).toLowerCase()]
      return want === undefined ? core.toggle(mod) : core.setEnabled(mod, want)
    }
    case 'on': case 'off': {
      // several at once: .on llama-esp spawner-notifier
      const mods = args.map(a => core.find(a) || (() => { throw new Error(`no module "${a}"`) })())
      if (!mods.length) need()
      for (const m of mods) core.setEnabled(m, cmd.toLowerCase() === 'on')
      return
    }
    case 'list': case 'modules': {
      const byCat = {}
      for (const m of core.modules.values()) (byCat[m.category] ||= []).push(`${m.enabled ? '§a' : '§7'}${m.name}`)
      for (const [cat, names] of Object.entries(byCat)) core.chat(`§d${cat}: ${names.join('§8, ')}`)
      return
    }
    case 'set': {
      need()
      const [, k, ...rest] = args
      const v = core.setSetting(mod, k, rest.join(' '))
      return core.chat(`§f${mod.name}.${k} §7= §f${Array.isArray(v) ? v.join(', ') : v}`)
    }
    case 'get': case 'info':
      need()
      core.chat(`§f${mod.name} §7(${mod.enabled ? '§aon' : '§coff'}§7) — ${mod.description}`)
      for (const [k, def] of Object.entries(mod.settings)) core.chat(`  §b${k} §7= §f${[].concat(mod.s[k]).join(', ')} §8(${def.type}${def.options ? ': ' + def.options.join('/') : ''})`)
      return
    case 'panic': case 'off':
      for (const m of core.enabledModules()) core.setEnabled(m, false, true)
      return core.chat('§cAll modules off.')
    case 'servertest':
      // Has the real server send a chat line; with --debug the proxy logs its exact format.
      return core.command('tellraw @s {"rawtext":[{"text":"§a[Glazed] server tellraw test"}]}')
    case 'chatformat':
      if (!['raw', 'system', 'json', 'chat', 'translation'].includes(args[0])) throw new Error('use raw, system, json, chat or translation')
      core.config.chatFormat = args[0]
      core.save()
      return core.chat(`Chat format set to §b${args[0]}`)
    case 'exploittest':
      return require('./exploittest').run(core)
    case 'bind':
      need()
      return core.startBind(mod)
    case 'unbind':
      need()
      core.unbind(mod.name)
      return core.chat(`§f${mod.name} §7has no bind now.`)
    case 'binds': {
      const list = Object.values(core.config.binds || {})
      return core.chat(list.length ? `§fBound to emotes: §b${list.join('§7, §b')}` : '§7No binds yet. Use §b.bind <module>§7.')
    }
    case 'server': {
      if (!args[0]) {
        const s = core.config.server
        return core.chat(`Server: §f${s.host}:${s.port}§7. Change it with §b${core.config.prefix}server <address> [port]`)
      }
      return core.setServer(args[0], args[1] || 19132)
    }
    case 'region': {
      const { x, z } = core.self.pos
      const r = regionAt(x, z)
      return core.chat(r < 0 ? 'Outside the region map.' : `Region §b${r}§f · ${continent(r)}`)
    }
    default: {
      const p = core.config.prefix
      core.chat(`§fCommands: §b${p}gui§7 (menu), §b${p}t <module>§7, §b${p}set <module> <setting> <value>§7, §b${p}get <module>§7, §b${p}list§7, §b${p}panic§7, §b${p}region`)
    }
  }
}

function main () {
  const config = loadConfig()
  // --local: test against a Bedrock Dedicated Server on this PC (online-mode=false), no Microsoft sign-in needed for that hop
  const debug = config.debug || process.argv.includes('--debug')
  const debugFile = debug && fs.createWriteStream(path.join(ROOT, 'proxy-debug.log'))
  // debug lines go to proxy-debug.log so the console stays readable
  const dlog = (...a) => debugFile.write(new Date().toISOString().slice(11, 23) + ' ' + a.join(' ') + '\n')
  const server = process.argv.includes('--local') ? { host: '127.0.0.1', port: 19132, offline: true } : config.server
  const core = new Core(config, CONFIG_PATH)
  // the relay keeps this object and reads it on every join, so .server can change it while running
  core.destination = { host: server.host, port: server.port, offline: !!server.offline }
  loadModules(core)
  core.save()

  const relay = new Relay({
    host: config.proxy.host,
    port: config.proxy.port,
    version: config.version,
    offline: !!server.offline,
    forceSingle: true,
    omitParseErrors: true, // drop malformed server packets instead of passing or disconnecting
    profilesFolder: path.join(ROOT, 'auth'),
    motd: { motd: 'Glazed Bedrock', levelName: 'Glazed' },
    destination: core.destination,
    onMsaCode: (code, player) => {
      console.log(`\n>>> Sign in to Microsoft: open ${code.verification_uri} and enter code ${code.user_code}\n`)
      player.disconnect(`§dGlazed: first-time sign-in\n§fOpen §b${code.verification_uri}§f and enter §e${code.user_code}§f, then rejoin.`)
    }
  })

  // The relay replaces any server kick with a generic "Backend server closed connection"; pass the real reason on.
  const openUpstream = relay.openUpstreamConnection.bind(relay)
  relay.openUpstreamConnection = async (ds, addr) => {
    await openUpstream(ds, addr)
    const up = relay.upstreams.get(addr.hash)
    up?.on('kick', p => {
      const reason = String(p.message || p.reason || 'no reason given').replace(/§./g, '')
      console.log('Server kicked the connection:', reason)
      ds.disconnect(`§c${core.destination.host}: §f${reason}`)
    })
    up?.on('error', e => console.log('Server connection error:', e.message))
  }

  relay.on('connect', player => {
    console.log('Client connected:', player.connection.address)
    const onClientbound = (name, params, des) => {
      if (debug && name === 'text') dlog('[debug] server -> game text', JSON.stringify(params))
      core.onClientbound(name, params, des)
    }
    const seenNames = new Set()
    const onServerbound = (name, params, des) => {
      if (debug) {
        if (!seenNames.has(name)) { seenNames.add(name); dlog('[debug] game sent first', name) }
        if (name === 'text' || name === 'command_request' || name === 'modal_form_response') dlog('[debug] game ->', name, JSON.stringify(params, (k, v) => typeof v === 'bigint' ? String(v) : v))
      }
      // The game finished loading: earlier chat/forms would have been dropped by its loading screen.
      if (name === 'set_local_player_as_initialized') welcome()
      if (name === 'text' && typeof params.message === 'string' && params.message.startsWith(config.prefix)) {
        console.log('[command]', params.message)
        des.canceled = true
        try {
          handleCommand(core, params.message.slice(config.prefix.length))
        } catch (e) {
          core.chat('§c' + e.message)
        }
        return
      }
      if (name === 'modal_form_response' && gui.handleResponse(core, params)) {
        des.canceled = true
        return
      }
      core.onServerbound(name, params, des)
    }
    passthrough.install(player, { onClientbound, onServerbound })
    player.on('close', () => {
      console.log('Client disconnected')
      for (const m of core.modules.values()) {
        if (!m.enabled) continue
        m._wantEnabled = !m.oneShot
        m.enabled = false
        try { m.onDisable?.() } catch {}
      }
      core.player = null
      core.reset()
    })
  })

  let welcomed = false
  function welcome () {
    if (welcomed || !core.player) return
    welcomed = true
    console.log('Game finished loading; client active')
    core.chat(`§fLoaded. Type §b${config.prefix}gui§f for the menu or §b${config.prefix}help§f for commands.`)
    for (const m of core.modules.values()) {
      if (m._wantEnabled) { m._wantEnabled = false; core.setEnabled(m, true, true) }
    }
  }

  relay.on('join', player => {
    console.log('Connected to', `${core.destination.host}:${core.destination.port}`)
    core.player = player
    core.self.name = player.profile?.name || ''
    welcomed = false
    if (debug) {
      const queue = player.queue.bind(player)
      const json = v => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? String(x) : x)
      player.queue = (name, params) => {
        // full dump for what the ESP modules touch
        if ((name === 'add_entity' && /llama|armor_stand|drowned|pillager|villager|wandering/.test(params.entity_type)) || name === 'block_entity_data') dlog('[debug] -> game', name, json(params).slice(0, 1500))
        if (name === 'set_entity_data' && params.metadata.some(m => m.key === 'nametag')) dlog('[debug] -> game', name, json(params).slice(0, 800))
        if (!['level_chunk', 'move_entity_delta', 'set_entity_data', 'network_chunk_publisher_update', 'update_attributes', 'set_time', 'move_player', 'subchunk', 'update_block', 'level_sound_event', 'move_entity', 'animate', 'set_entity_motion'].includes(name)) dlog('[debug] -> game', name)
        return queue(name, params)
      }
    }
    setTimeout(welcome, 20000) // fallback if the game never reports it finished loading
  })

  setInterval(() => {
    if (!core.player) return
    core.emit('onTick')
    core.renderHud()
    core.renderBeams()
  }, 50)

  relay.listen()
  // Ctrl+C / closing the window: kick players with a clear reason instead of leaving them to time out
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    console.log('Stopping Glazed Bedrock...')
    const quit = () => process.exit(0)
    relay.close('§dGlazed Bedrock was closed.§f Join the server directly to play without it.').then(quit, quit)
    setTimeout(quit, 2000).unref()
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, stop)
  console.log(`Glazed Bedrock proxy on ${config.proxy.host}:${config.proxy.port} -> ${server.host}:${server.port} (Bedrock ${config.version})`)
  console.log(`Add a server in Minecraft with address 127.0.0.1 and port ${config.proxy.port}.`)
}

if (require.main === module) main()
module.exports = { handleCommand, loadModules }
