// Runs a local Bedrock Dedicated Server for testing and ops every player who joins, so /summon, /setblock etc. work.
//   node tools/local-server.js [path-to-bedrock_server-folder]
// Anything you type is passed through to the server console.
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')

const dir = process.argv[2] || path.join(os.homedir(), 'bds-test', 'server')
const server = spawn(path.join(dir, 'bedrock_server.exe'), [], { cwd: dir, stdio: ['pipe', 'pipe', 'inherit'] })

server.stdout.on('data', chunk => {
  process.stdout.write(chunk)
  for (const m of chunk.toString().matchAll(/Player Spawned: (.+?) xuid/g)) server.stdin.write(`op "${m[1].trim()}"\n`)
})
process.stdin.pipe(server.stdin)
server.on('exit', code => process.exit(code ?? 0))
process.on('SIGINT', () => server.stdin.write('stop\n'))
