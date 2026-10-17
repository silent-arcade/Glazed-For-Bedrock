// Forwards packets byte-for-byte unless a module actually changed them.
// bedrock-protocol's Relay decodes and re-encodes every packet; any small schema mismatch then corrupts packets
// the game receives (seen as random Bedrock crashes). Only packet types modules may edit are compared and re-encoded.

const EDITABLE = {
  clientbound: new Set(['text', 'set_title', 'add_entity', 'add_player', 'set_entity_data', 'set_entity_motion', 'motion_prediction_hints']),
  serverbound: new Set(['inventory_transaction', 'request_chunk_radius', 'player_auth_input'])
}
const json = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : Buffer.isBuffer(x) ? x.toString('hex') : x))

// handler(name, params, des) runs the modules; returns how to forward: 'drop', 'raw' or 're-encode'.
function decide (direction, name, params, des, handler) {
  const before = EDITABLE[direction].has(name) ? json(params) : null
  handler(name, params, des)
  if (des.canceled) return 'drop'
  return before !== null && json(params) !== before ? 're-encode' : 'raw'
}

function install (player, { onClientbound, onServerbound }) {
  const deserializer = player.server.deserializer

  // Backend -> proxy -> game (mirrors RelayPlayer.readUpstream)
  player.readUpstream = function (packet) {
    if (!this.startRelaying) { this.downQ.push(packet); return }
    let des
    try {
      des = deserializer.parsePacketBuffer(packet)
    } catch (e) {
      // Unknown to our schema: the game may still understand it, so pass it on untouched.
      this.sendBuffer(packet)
      return
    }
    const { name, params } = des.data
    if (name === 'play_status' && params.status === 'login_success') return // the relay already sent this
    const how = decide('clientbound', name, params, des, onClientbound)
    if (how === 'drop') return
    if (name === 'item_registry' || name === 'start_game') this._processOutbound(name, params)
    if (name === 'start_game') setTimeout(() => { this.sentStartGame = true }, 500)
    else if (name === 'level_chunk' && !this.sentStartGame) { this.chunkSendCache.push(packet); return }
    if (how === 're-encode') this.queue(name, params)
    else this.sendBuffer(packet)
    if (this.chunkSendCache.length && this.sentStartGame) {
      for (const buf of this.chunkSendCache) this.sendBuffer(buf)
      this.chunkSendCache = []
    }
  }

  // Game -> proxy -> backend (mirrors RelayPlayer.readPacket once relaying)
  const original = player.readPacket.bind(player)
  player.readPacket = function (packet) {
    if (!this.startRelaying || !this.upstream) return original(packet)
    this.flushUpQueue()
    let des
    try {
      des = deserializer.parsePacketBuffer(packet)
    } catch (e) {
      this.upstream.sendBuffer(packet)
      return
    }
    const { name, params } = des.data
    const how = decide('serverbound', name, params, des, onServerbound)
    if (how === 'drop') return
    if (name === 'client_cache_status') return this.upstream.queue('client_cache_status', { enabled: false })
    if (name === 'set_local_player_as_initialized') this.status = 3
    if (how === 're-encode') this.upstream.queue(name, params)
    else this.upstream.sendBuffer(packet)
  }
}

module.exports = { install, decide, EDITABLE }
