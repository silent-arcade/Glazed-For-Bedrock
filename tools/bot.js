// Test bot you control from the terminal. Joins through the proxy (or straight to the server with --direct).
//   node tools/bot.js [name] [--direct]
// Type a message to chat, .command for the client, /command for the server, !help for bot controls.
const readline = require('readline')
const bp = require('bedrock-protocol')
const { CURRENT_VERSION } = require('bedrock-protocol/src/options')

const args = process.argv.slice(2)
const direct = args.includes('--direct')
const name = args.find(a => !a.startsWith('--')) || 'GlazedBot'
const port = direct ? 19132 : 19134
const strip = s => String(s ?? '').replace(/§./g, '')

const client = bp.createClient({ host: '127.0.0.1', port, offline: true, username: name, version: CURRENT_VERSION, transport: 'raknet', skipPing: true })
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
const log = msg => { readline.clearLine(process.stdout, 0); readline.cursorTo(process.stdout, 0); console.log(msg); rl.prompt(true) }

let pos = { x: 0, y: 0, z: 0 }
let runtimeId = 0n
let lastForm = null
let commandOrigin = null

client.on('start_game', p => {
  runtimeId = p.runtime_entity_id
  pos = p.player_position
  commandOrigin = { type: 'player', uuid: client.profile?.uuid || '00000000-0000-0000-0000-000000000000', request_id: '', player_entity_id: p.entity_id }
})
client.on('spawn', () => log(`Joined as ${name} via ${direct ? 'server directly' : 'proxy'} (port ${port}). Type !help for controls.`))
client.on('text', p => log(`[chat] ${strip(p.source_name ? `<${p.source_name}> ` : '')}${strip(p.message)}${p.parameters?.length ? ' ' + p.parameters.join(' ') : ''}`))
client.on('command_output', p => {
  for (const o of p.output) log(`[${o.success ? 'command' : 'command failed'}] ${o.message_id}${o.parameters.length ? ' ' + o.parameters.map(strip).join(' | ') : ''}`)
})
client.on('set_title', p => { if (p.text) log(`[${p.type}] ${strip(p.text)}`) })
client.on('move_player', p => {
  if (p.runtime_id !== runtimeId && BigInt(p.runtime_id) !== BigInt(runtimeId)) return
  pos = p.position
  if (p.mode === 'teleport' || p.mode === 'reset') log(`[moved] ${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`)
})
client.on('modal_form_request', p => {
  lastForm = p
  try {
    const f = JSON.parse(p.data)
    log(`[form] ${strip(f.title)} (${f.type}) - answer with !form <...>`)
    if (f.content && typeof f.content === 'string') log('       ' + strip(f.content).slice(0, 200))
    if (f.buttons) f.buttons.forEach((b, i) => log(`   ${i}: ${strip(b.text).split('\n')[0]}`))
    if (f.type === 'modal') log(`   true: ${strip(f.button1)}   false: ${strip(f.button2)}`)
    if (f.type === 'custom_form') f.content.forEach((e, i) => log(`   [${i}] ${e.type}: ${strip(e.text).split('\n')[0]} (now: ${JSON.stringify(e.default ?? null)})`))
  } catch {
    log(`[form] unreadable, ${p.data.length} characters`)
  }
})
client.on('kick', p => { log(`[kicked] ${strip(p.message)}`); process.exit(1) })
client.on('close', () => { log('[disconnected]'); process.exit(0) })
client.on('error', e => log(`[error] ${e.message}`))

function chat (message) {
  client.queue('text', { needs_translation: false, category: 'authored', type: 'chat', source_name: name, message, xuid: '', platform_chat_id: '', has_filtered_message: false })
}

function answerForm (raw) {
  if (!lastForm) return log('No form open.')
  const f = JSON.parse(lastForm.data)
  let data
  if (raw === 'close') data = null
  else if (f.type === 'custom_form') {
    // keep each field's current value unless overridden: !form 0=true 3=hello
    const values = f.content.map(e => e.default ?? null)
    for (const part of raw.split(/\s+/).filter(Boolean)) {
      const [i, v] = part.split('=')
      values[Number(i)] = v === 'true' ? true : v === 'false' ? false : (/^-?\d+$/.test(v) && f.content[Number(i)]?.type === 'dropdown' ? Number(v) : v)
    }
    data = values
  } else data = JSON.parse(raw)
  client.queue('modal_form_response', { form_id: lastForm.form_id, has_response_data: data !== null, data: data === null ? undefined : JSON.stringify(data), has_cancel_reason: data === null, cancel_reason: data === null ? 'closed' : undefined })
  lastForm = null
}

const HELP = `Controls:
  hello            say "hello" in chat
  .gui / .t ...    client commands (handled by the proxy)
  /tp 0 100 0      server commands (op the bot first: type "op ${name}" in the server window)
  !form 2          press button 2 on the last form (!form true/false for yes-no, !form close to close)
  !form 0=true 3=5 set fields on a settings form (unlisted fields keep their value)
  !pos             show position
  !quit            leave`

rl.on('line', line => {
  const l = line.trim()
  if (!l) return rl.prompt()
  try {
    if (l === '!help') log(HELP)
    else if (l === '!quit') { client.close(); process.exit(0) }
    else if (l === '!pos') log(`${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}`)
    else if (l.startsWith('!form')) answerForm(l.slice(5).trim())
    else if (l.startsWith('/')) client.queue('command_request', { command: l, origin: commandOrigin, internal: false, version: 'latest' })
    else chat(l)
  } catch (e) {
    log(`[error] ${e.message}`)
  }
  rl.prompt()
})
