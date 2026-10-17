// In-game click GUI built from Bedrock server forms.
const FORM_ID_BASE = 0x6c000000
let nextId = FORM_ID_BASE
const pending = new Map() // form id -> { form, handler, tries }
const BUSY_RETRY_MS = 500
const BUSY_MAX_TRIES = 60 // ~30 s to close the chat screen

function show (core, form, handler, tries = 0) {
  const id = nextId++
  pending.set(id, { form, handler, tries })
  core.toClient('modal_form_request', { form_id: id, data: JSON.stringify(form) })
}

// Returns true when the response belonged to one of our forms (and must not reach the server).
function handleResponse (core, p) {
  const entry = pending.get(p.form_id)
  if (!entry) return false
  pending.delete(p.form_id)
  const { form, handler, tries } = entry
  // The game answers "busy" while another screen (like chat) is open: resend until it can show the form.
  if (p.has_cancel_reason && p.cancel_reason === 'busy') {
    if (tries < BUSY_MAX_TRIES) setTimeout(() => show(core, form, handler, tries + 1), BUSY_RETRY_MS)
    return true
  }
  if (p.has_response_data && p.data && p.data.trim() !== 'null') {
    try {
      handler(JSON.parse(p.data))
    } catch (e) {
      core.chat('§c' + e.message)
    }
  }
  return true
}

function categories (core) { return [...new Set([...core.modules.values()].map(m => m.category))] }

// Vanilla texture paths; a wrong path only shows a blank icon.
const ICONS = {
  Protection: 'textures/items/totem',
  Main: 'textures/items/emerald',
  ESP: 'textures/items/ender_eye',
  Performance: 'textures/items/redstone_dust',
  Render: 'textures/items/glowstone_dust',
  Client: 'textures/items/compass_item'
}
const icon = cat => (ICONS[cat] ? { image: { type: 'path', data: ICONS[cat] } } : {})
const title = name => name.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

function openMain (core) {
  const cats = categories(core)
  const on = core.enabledModules().filter(m => !m.oneShot)
  const buttons = cats.map(c => {
    const mods = [...core.modules.values()].filter(m => m.category === c)
    const n = mods.filter(m => m.enabled).length
    return { text: `§l${c}§r\n${n ? `§a${n} on` : '§8all off'} §8· ${mods.length} modules`, ...icon(c) }
  })
  buttons.push({ text: `§lEnabled modules§r\n§8${on.length} on`, image: { type: 'path', data: 'textures/items/book_enchanted' } })
  buttons.push({ text: `§lServer§r\n§8${core.config.server.host}:${core.config.server.port}`, image: { type: 'path', data: 'textures/items/map_filled' } })
  buttons.push({ text: '§c§lTurn everything off', image: { type: 'path', data: 'textures/blocks/barrier' } })
  show(core, {
    type: 'form',
    title: '§l§dGlazed§r §fBedrock',
    content: `§7${on.length} modules on. Open with §d${core.config.prefix}gui§7 or double-tap sneak.`,
    buttons
  }, i => {
    if (i < cats.length) return openCategory(core, cats[i])
    if (i === cats.length) return openPanel(core, 'Enabled modules', on)
    if (i === cats.length + 1) return openServer(core)
    for (const m of core.enabledModules()) core.setEnabled(m, false, true)
    core.chat('§cAll modules off.')
    openMain(core)
  })
}

function openCategory (core, cat) {
  openPanel(core, cat, [...core.modules.values()].filter(m => m.category === cat))
}

// One screen per category, like a click-GUI column: a toggle per module (flip several, then submit) and a
// picker at the bottom to open one module's settings.
function openPanel (core, heading, mods) {
  const withSettings = mods // every module has a settings page now (at least its bind)
  const content = mods.map(m => ({
    type: 'toggle',
    text: `${m.oneShot ? '§e▶ Run ' : ''}§l${title(m.name)}§r\n§7${m.description}`,
    default: !m.oneShot && m.enabled
  }))
  content.push({ type: 'dropdown', text: '§lOpen settings for', options: ['§7(none)', ...withSettings.map(m => title(m.name))], default: 0 })
  show(core, { type: 'custom_form', title: `§l${heading}`, content }, values => {
    mods.forEach((m, i) => {
      const on = !!values[i]
      if (m.oneShot) { if (on) core.setEnabled(m, true) } else if (on !== m.enabled) core.setEnabled(m, on)
    })
    const pick = values[mods.length]
    if (pick > 0) openSettings(core, withSettings[pick - 1], () => openPanel(core, heading, mods))
  })
}

function openServer (core) {
  const cur = core.config.server
  const list = core.servers
  const current = list.findIndex(s => s.host === cur.host && s.port === cur.port)
  show(core, {
    type: 'custom_form',
    title: '§lServer',
    content: [
      { type: 'dropdown', text: '§lGo to§r\n§7Pick a server and press Submit to switch now', options: list.map(s => s.port === 19132 ? s.host : `${s.host}:${s.port}`), default: Math.max(0, current) },
      { type: 'input', text: '§lOr add a new server§r\n§7Leave empty to use the one picked above', placeholder: 'play.example.net', default: '' },
      { type: 'input', text: '§lPort', placeholder: '19132', default: '' }
    ]
  }, ([pick, host, port]) => {
    if (String(host).trim()) return core.setServer(host, port || 19132)
    const s = list[pick]
    if (s && (s.host !== cur.host || s.port !== cur.port)) core.setServer(s.host, s.port)
  })
}

function openSettings (core, mod, back) {
  const entries = Object.entries(mod.settings)
  const bound = core.bindsFor(mod.name).length > 0
  const content = entries.map(([k, def]) => {
    const v = mod.s[k]
    const text = `§l${k}§r\n§7${def.desc || ''}`
    if (def.type === 'bool') return { type: 'toggle', text, default: v }
    if (def.type === 'enum') return { type: 'dropdown', text, options: def.options, default: Math.max(0, def.options.indexOf(v)) }
    return { type: 'input', text, placeholder: def.type === 'list' ? 'comma, separated' : '', default: Array.isArray(v) ? v.join(', ') : String(v) }
  })
  content.push({ type: 'dropdown', text: `§lBind§r\n§7${bound ? 'Bound to an emote' : 'Not bound'}`, options: ['Keep as is', 'Bind to an emote (use it after saving)', 'Remove bind'], default: 0 })
  show(core, { type: 'custom_form', title: `§l${title(mod.name)} settings`, content }, values => {
    entries.forEach(([k, def], i) => core.setSetting(mod, k, def.type === 'enum' ? def.options[values[i]] : values[i]))
    core.chat(`§aSaved ${mod.name} settings.`)
    const bindChoice = values[entries.length]
    if (bindChoice === 1) return core.startBind(mod) // the next emote binds; don't reopen a menu over it
    if (bindChoice === 2) core.unbind(mod.name)
    back()
  })
}

module.exports = { openMain, handleResponse, categoryCount: core => categories(core).length }
