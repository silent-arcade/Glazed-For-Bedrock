const { execFile } = require('child_process')

// Accepts "1500", "10k", "1.5m", "2b"
function parseAmount (s) {
  const m = String(s).trim().toLowerCase().match(/^(-?\d+(?:\.\d+)?)([kmb]?)$/)
  if (!m) return NaN
  return Number(m[1]) * { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]]
}

function dist2d (a, b) { return Math.hypot(a.x - b.x, a.z - b.z) }
function dist3d (a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }
function fmtPos (p) { return `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}` }
function shortName (id) { return String(id).replace(/^minecraft:/, '') }

async function webhook (url, content, discordId) {
  if (!url) return
  const body = { content: discordId ? `<@${discordId}> ${content}` : content }
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) console.warn('[webhook] HTTP', res.status)
  } catch (e) {
    console.warn('[webhook] failed:', e.message)
  }
}

function copyToClipboard (text) {
  if (process.platform !== 'win32') return
  const p = execFile('clip')
  p.stdin.end(text)
}

module.exports = { parseAmount, dist2d, dist3d, fmtPos, shortName, webhook, copyToClipboard }
