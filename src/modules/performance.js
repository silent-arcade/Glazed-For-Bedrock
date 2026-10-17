// FPS helpers that work by sending the game less to draw.
const CAT = 'Performance'

module.exports = [
  {
    name: 'no-particles',
    category: CAT,
    description: 'Drops server particles (explosions, crits, spells...)',
    clientbound (name, p) {
      if (name === 'spawn_particle_effect') return false
      if (name === 'level_event' && typeof p.event === 'string' && /^(add_)?particle_/.test(p.event)) return false
    }
  },

  {
    name: 'chunk-limiter',
    category: CAT,
    description: 'Caps render distance below what the game asks for',
    settings: { radius: { type: 'int', default: 8, desc: 'Max chunk radius (lower = more FPS)' } },
    serverbound (name, p) {
      if (name !== 'request_chunk_radius') return
      this.requested = p.chunk_radius
      p.chunk_radius = Math.min(p.chunk_radius, Math.max(2, this.s.radius))
      p.max_radius = Math.min(p.max_radius, p.chunk_radius)
    },
    onEnable () { this.resend(this.s.radius) },
    onSettingChanged () { if (this.enabled) this.resend(this.s.radius) },
    onDisable () { if (this.requested) this.resend(this.requested) },
    resend (r) {
      r = Math.max(2, r)
      this.c.toServer('request_chunk_radius', { chunk_radius: r, max_radius: r })
    }
  },

  {
    name: 'no-weather',
    category: CAT,
    description: 'Hides rain and thunder (rain-noti still works)',
    clientbound (name, p) {
      if (name === 'level_event' && (p.event === 'start_rain' || p.event === 'start_thunder')) return false
    },
    onEnable () {
      for (const event of ['stop_rain', 'stop_thunder']) this.c.toClient('level_event', { event, position: { x: 0, y: 0, z: 0 }, data: 0 })
    }
  }
]
