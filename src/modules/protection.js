// Stops crash/lag packets from reaching the game.
const { key } = require('../core')

const CAT = 'Protection'
const WORLD_LIMIT = 3e7 // past the world border; real positions never get here

const badNum = n => !Number.isFinite(n) || Math.abs(n) > WORLD_LIMIT
const badVec = v => !v || badNum(v.x) || badNum(v.y) || badNum(v.z)

module.exports = [
  {
    name: 'anti-exploit',
    category: CAT,
    defaultEnabled: true,
    description: 'Blocks crash and lag packets (form spam, huge text, particle/sound/entity floods, bad positions)',
    settings: {
      'max-forms-per-sec': { type: 'int', default: 3, desc: 'Server forms allowed per second' },
      'max-form-size': { type: 'int', default: 30000, desc: 'Largest form (characters) allowed' },
      'max-text-length': { type: 'int', default: 1500, desc: 'Chat/title text longer than this is cut' },
      'max-nametag-length': { type: 'int', default: 200, desc: 'Name tags longer than this are cut' },
      'max-particles-per-sec': { type: 'int', default: 300, desc: 'Particle packets allowed per second' },
      'max-sounds-per-sec': { type: 'int', default: 60, desc: 'Sound packets allowed per second' },
      'max-entities-per-sec': { type: 'int', default: 250, desc: 'New non-player entities allowed per second' },
      'max-velocity': { type: 'int', default: 60, desc: 'Fastest knockback/motion allowed (blocks per tick)' },
      'block-transfer': { type: 'bool', default: false, desc: 'Block server transfers (they bypass this client)' },
      alerts: { type: 'bool', default: true, desc: 'Tell you in chat when something is blocked' }
    },
    onEnable () {
      this.windowStart = 0
      this.counts = {}
      this.blocked = {}
      this.lastReport = Date.now()
    },
    // true = over the per-second budget
    over (bucket, limit) {
      const now = Date.now()
      if (now - this.windowStart >= 1000) { this.windowStart = now; this.counts = {} }
      this.counts[bucket] = (this.counts[bucket] || 0) + 1
      return this.counts[bucket] > limit
    },
    block (what) {
      this.blocked[what] = (this.blocked[what] || 0) + 1
      return false
    },
    cut (s, max) { return typeof s === 'string' && s.length > max ? s.slice(0, max) + '§r…' : s },
    capNametags (metadata) {
      for (const m of metadata || []) {
        if (m.key === 'nametag' || m.key === 'score_tag' || m.key === 'interact_text') m.value = this.cut(m.value, this.s['max-nametag-length'])
      }
    },
    clientbound (name, p) {
      const s = this.s
      switch (name) {
        case 'modal_form_request':
          if (p.data.length > s['max-form-size']) return this.block('oversized form')
          if (this.over('form', s['max-forms-per-sec'])) return this.block('form spam')
          break
        case 'text':
          if (typeof p.message === 'string') p.message = this.cut(p.message, s['max-text-length'])
          if (Array.isArray(p.parameters)) {
            if (p.parameters.length > 50) return this.block('huge translated message')
            p.parameters = p.parameters.map(x => this.cut(x, s['max-text-length']))
          }
          break
        case 'set_title':
          p.text = this.cut(p.text, s['max-text-length'])
          break
        case 'spawn_particle_effect':
          if (this.over('particle', s['max-particles-per-sec'])) return this.block('particle flood')
          break
        case 'level_event':
          if (/particle/.test(String(p.event)) && this.over('particle', s['max-particles-per-sec'])) return this.block('particle flood')
          if (badVec(p.position)) return this.block('bad position')
          break
        case 'play_sound':
        case 'level_sound_event':
          if (this.over('sound', s['max-sounds-per-sec'])) return this.block('sound flood')
          break
        case 'add_entity':
          if (badVec(p.position) || badVec(p.velocity)) return this.block('bad entity position')
          if (this.over('entity', s['max-entities-per-sec'])) return this.block('entity flood')
          this.capNametags(p.metadata)
          break
        case 'add_player':
          if (badVec(p.position)) return this.block('bad player position')
          p.username = this.cut(p.username, 64)
          this.capNametags(p.metadata)
          break
        case 'set_entity_data':
          this.capNametags(p.metadata)
          break
        case 'move_player':
        case 'move_entity':
          if (badVec(p.position)) return this.block('bad position')
          break
        case 'move_entity_delta':
          if ([p.x, p.y, p.z].some(n => n != null && badNum(n))) return this.block('bad position')
          break
        case 'set_entity_motion':
        case 'motion_prediction_hints': {
          const v = p.velocity
          if (badVec(v) || Math.hypot(v.x, v.y, v.z) > s['max-velocity']) {
            // Own-player launches get scaled down instead of dropped so knockback still happens.
            if (name === 'set_entity_motion' && key(p.runtime_entity_id) === this.c.self.runtimeId && !badVec(v)) {
              const f = s['max-velocity'] / Math.hypot(v.x, v.y, v.z)
              p.velocity = { x: v.x * f, y: v.y * f, z: v.z * f }
              this.blocked['huge knockback (reduced)'] = (this.blocked['huge knockback (reduced)'] || 0) + 1
              break
            }
            return this.block('extreme velocity')
          }
          break
        }
        case 'transfer':
          this.c.chat(`§eServer is transferring you to §f${p.server_address}:${p.port}§e. That connection skips this client.`)
          if (s['block-transfer']) return this.block('transfer')
          break
      }
    },
    onTick () {
      if (Date.now() - this.lastReport < 5000) return
      this.lastReport = Date.now()
      const parts = Object.entries(this.blocked).map(([k, n]) => `${k} ×${n}`)
      if (!parts.length) return
      this.blocked = {}
      console.log('[anti-exploit] blocked:', parts.join(', '))
      if (this.s.alerts) this.c.chat(`§6Blocked: §f${parts.join('§7, §f')}`)
    }
  }
]
