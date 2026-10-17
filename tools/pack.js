// Builds dist/glazed-bedrock.zip to share. Only the files listed here go in, so auth/ (your Microsoft login),
// config.json and node_modules can never end up in it.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const INCLUDE = ['src', 'tools', 'test', 'start.bat', 'package.json', 'package-lock.json', 'README.md', 'GUIDE.md', 'LICENSE', '.gitignore']
const out = path.join(ROOT, 'dist', 'glazed-bedrock.zip')

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.rmSync(out, { force: true })
const files = INCLUDE.filter(f => fs.existsSync(path.join(ROOT, f)))
// Windows 10+ ships bsdtar, which writes zip files with -a
execFileSync('tar', ['-a', '-c', '-f', out, ...files], { cwd: ROOT, stdio: 'inherit' })

const listing = execFileSync('tar', ['-t', '-f', out], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
const leaked = listing.filter(f => /^(auth|node_modules)\/|^config\.json$|proxy-debug\.log/.test(f))
if (leaked.length) {
  fs.rmSync(out)
  throw new Error('refusing to build: private files would be included: ' + leaked.join(', '))
}
console.log(`Made ${path.relative(ROOT, out)} (${listing.length} entries, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
