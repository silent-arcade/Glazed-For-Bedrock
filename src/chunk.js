// Pulls block entities (spawners, chests, banners...) out of Bedrock network chunk payloads.
// Block states are skipped, not decoded: their runtime IDs depend on the server's palette.
const nbt = require('prismarine-nbt')

function readVarint (buf, o) {
  let v = 0
  let shift = 0
  for (;;) {
    if (o >= buf.length) throw new RangeError('varint past end')
    const b = buf[o++]
    v += (b & 0x7f) * 2 ** shift
    if (!(b & 0x80)) return [v, o]
    shift += 7
    if (shift > 35) throw new RangeError('varint too long')
  }
}

function skipStorage (buf, o, isBiome) {
  const header = buf[o++]
  if (header === undefined) throw new RangeError('storage past end')
  if (isBiome && header === 0xff) return o // same palette as previous section
  if (!(header & 1)) throw new Error('persistent palette in network chunk')
  const bits = header >> 1
  if (bits === 0) return readVarint(buf, o)[1]
  if (![1, 2, 3, 4, 5, 6, 8, 16].includes(bits)) throw new Error('bad bits per block ' + bits)
  const perWord = Math.floor(32 / bits)
  o += Math.ceil(4096 / perWord) * 4
  let size
  ;[size, o] = readVarint(buf, o)
  size = (size >>> 1) ^ -(size & 1) // zigzag
  if (size < 0 || size > 4096) throw new Error('bad palette size')
  for (let i = 0; i < size; i++) o = readVarint(buf, o)[1]
  return o
}

function skipSubChunk (buf, o) {
  const version = buf[o++]
  if (version === 1) return skipStorage(buf, o, false)
  if (version !== 8 && version !== 9) throw new Error('unknown subchunk version ' + version)
  const layers = buf[o++]
  if (version === 9) o++ // y index
  for (let i = 0; i < layers; i++) o = skipStorage(buf, o, false)
  return o
}

function readBlockEntities (buf, o) {
  const out = []
  while (o < buf.length) {
    const { data, metadata } = nbt.protos.littleVarint.parsePacketBuffer('nbt', buf, o)
    out.push(nbt.simplify(data))
    o += metadata.size
  }
  return out
}

// Biome section count differs per dimension (and per server), so try each and keep the one that parses cleanly.
const BIOME_SECTION_COUNTS = [24, 25, 16, 8]

function blockEntitiesFromLevelChunk (payload, subChunkCount) {
  let o = 0
  for (let i = 0; i < subChunkCount; i++) o = skipSubChunk(payload, o)
  for (const n of BIOME_SECTION_COUNTS) {
    try {
      let p = o
      for (let i = 0; i < n; i++) p = skipStorage(payload, p, true)
      const border = payload[p++]
      if (border === undefined) continue
      p += border
      if (p > payload.length) continue
      return readBlockEntities(payload, p)
    } catch {}
  }
  return []
}

function blockEntitiesFromSubChunk (payload) {
  return readBlockEntities(payload, skipSubChunk(payload, 0))
}

module.exports = { blockEntitiesFromLevelChunk, blockEntitiesFromSubChunk }
