const { parseAmount, dist2d, fmtPos, shortName, copyToClipboard } = require('../util')
const { key } = require('../core')

const CAT = 'Main'
const notifyMode = { type: 'enum', options: ['actionbar', 'chat', 'both', 'title'], default: 'actionbar', desc: 'actionbar = small above the hotbar, both = actionbar + chat, title = big' }
const webhookSettings = {
  webhook: { type: 'bool', default: false, desc: 'Send Discord webhook alerts' },
  'webhook-url': { type: 'string', default: '', desc: 'Discord webhook URL' },
  'self-ping': { type: 'bool', default: false, desc: 'Ping yourself in the webhook' },
  'discord-id': { type: 'string', default: '', desc: 'Your Discord user ID' }
}
const lower = list => list.map(n => n.toLowerCase())

// Runs steps one after another with delays; stops early if the module is turned off.
function runSteps (mod, steps, done) {
  let i = 0
  const next = () => {
    if (!mod.enabled || i >= steps.length) return done?.()
    const [fn, wait] = steps[i++]
    fn()
    mod._timer = setTimeout(next, wait)
  }
  next()
}

// Sells hotbar slots one by one: select slot, wait for the client to switch, run /ah sell.
function sellSlots (mod, slots, price, delay) {
  const c = mod.c
  const steps = []
  for (const slot of slots) {
    steps.push([() => c.selectSlot(slot), 300])
    steps.push([() => c.command(`ah sell ${price}`), delay])
  }
  runSteps(mod, steps, () => {
    if (mod.s.notifications !== false) c.chat(`§aSold ${slots.length} slot(s).`)
    c.setEnabled(mod, false, true)
  })
}

function adminNames (c) {
  const m = c.modules.get('admin-list')
  return m?.enabled ? lower(m.s.names) : []
}

module.exports = [
  {
    name: 'admin-list',
    category: CAT,
    description: 'Staff names that other modules ignore',
    settings: { names: { type: 'list', default: [], desc: 'Comma-separated staff names' } }
  },

  {
    name: 'admin-hud',
    category: CAT,
    description: 'Tells you when staff are online',
    settings: {
      names: { type: 'list', default: [], desc: 'Staff names to watch' },
      'chat-notify': { type: 'bool', default: true, desc: 'Chat line when staff join or leave/vanish' },
      sound: { type: 'bool', default: true, desc: 'Play a sound on changes' },
      'show-panel': { type: 'bool', default: true, desc: 'Show online staff above the hotbar' }
    },
    online () {
      const watch = lower(this.s.names)
      return [...this.c.players.values()].filter(n => watch.includes(n.toLowerCase()))
    },
    onEnable () {
      this.last = 0
      const on = this.online()
      this.c.info(on.length ? `§cStaff online: §f${on.join(', ')}` : '§aNo watched staff online.')
    },
    clientbound (name, p) {
      if (name !== 'player_list') return
      const watch = lower(this.s.names)
      for (const r of p.records) {
        const user = r.type === 'add' ? r.username : this.c.players.get(r.uuid)
        if (!user || !watch.includes(user.toLowerCase())) continue
        if (this.s['chat-notify']) this.c.info(r.type === 'add' ? `§cStaff joined: §f${user}` : `§eStaff left or vanished: §f${user}`)
        if (this.s.sound) this.c.sound('note.bell', r.type === 'add' ? 1 : 0.6)
      }
    },
    onTick () {
      if (!this.s['show-panel'] || Date.now() - this.last < 1500) return
      this.last = Date.now()
      const on = this.online()
      if (on.length) this.c.actionbar(`§cStaff: §f${on.join('§7, §f')}`, true)
    }
  },

  {
    name: 'ah-sell',
    category: CAT,
    oneShot: true,
    description: 'Sells every hotbar item with /ah sell',
    settings: {
      price: { type: 'string', default: '1k', desc: 'Price per listing (supports k/m/b)' },
      delay: { type: 'int', default: 1200, desc: 'Milliseconds between listings' },
      notifications: { type: 'bool', default: true, desc: 'Chat feedback' }
    },
    onEnable () {
      const slots = this.c.hotbar().map((n, i) => (n ? i : -1)).filter(i => i >= 0)
      if (!slots.length) { this.c.chat('§cHotbar is empty.'); return this.c.setEnabled(this, false, true) }
      sellSlots(this, slots, this.s.price, this.s.delay)
    },
    onDisable () { clearTimeout(this._timer) }
  },

  {
    name: 'emergency-seller',
    category: CAT,
    oneShot: true,
    description: 'Panic-lists chosen hotbar items on /ah for 1b',
    settings: {
      items: { type: 'list', default: ['spawner'], desc: 'Item names to sell (e.g. spawner, elytra)' },
      'sell-hotbar-slot-1': { type: 'bool', default: true, desc: 'Always sell whatever is in slot 1' },
      price: { type: 'string', default: '1b', desc: 'Listing price' },
      notifications: { type: 'bool', default: true, desc: 'Chat feedback' }
    },
    onEnable () {
      const wanted = lower(this.s.items)
      const slots = this.c.hotbar().map((n, i) => {
        if (!n) return -1
        if (i === 0 && this.s['sell-hotbar-slot-1']) return 0
        return wanted.includes(shortName(n)) ? i : -1
      }).filter(i => i >= 0)
      if (!slots.length) { this.c.chat('§cNothing to sell.'); return this.c.setEnabled(this, false, true) }
      sellSlots(this, slots, this.s.price, 600)
    },
    onDisable () { clearTimeout(this._timer) }
  },

  {
    name: 'coord-snapper',
    category: CAT,
    oneShot: true,
    description: 'Copies your coordinates to the clipboard (+ webhook)',
    settings: { 'chat-feedback': { type: 'bool', default: true, desc: 'Chat message' }, ...webhookSettings },
    onEnable () {
      const text = fmtPos(this.c.self.pos)
      copyToClipboard(text)
      if (this.s['chat-feedback']) this.c.chat(`§aCopied §f${text}`)
      this.c.hook(this, `Coordinates: ${text} (${this.c.self.dimension})`)
      this.c.setEnabled(this, false, true)
    }
  },

  {
    // Your game flies freely (and through blocks) while the server is told you're standing still where
    // you turned it on. Turning it off puts you back there. Actions are held back so nothing happens at your body.
    name: 'glazed-freecam',
    category: CAT,
    description: 'Fly the camera around freely while your body stays put',
    settings: {
      speed: { type: 'int', default: 2, desc: 'Fly speed (1 = vanilla creative)' },
      noclip: { type: 'bool', default: true, desc: 'Fly through blocks and under the ground (double-tap jump to fly first)' }
    },
    onEnable () {
      const c = this.c
      if (!c.selfAbilities || !c.self.look) { c.chat('§cMove a little first, then try again.'); return c.setEnabled(this, false, true) }
      this.body = { ...c.self.pos }
      this.look = { ...c.self.look }
      const grant = structuredClone(c.selfAbilities)
      for (const layer of grant.abilities) {
        if (layer.type !== 'base') continue
        for (const set of [layer.allowed, layer.enabled]) Object.assign(set, { flying: true, may_fly: true, no_clip: !!this.s.noclip })
        layer.fly_speed = 0.05 * Math.max(1, this.s.speed)
      }
      c.toClient('update_abilities', grant)
      c.actionbar(`§bFreecam on §7· double-tap jump to fly${this.s.noclip ? ', sneak to go underground' : ''}`)
    },
    onDisable () {
      const c = this.c
      if (!this.body) return
      if (c.selfAbilities) c.toClient('update_abilities', c.selfAbilities)
      c.toClient('move_player', {
        runtime_id: Number(c.self.runtimeId),
        position: { x: this.body.x, y: this.body.y + 1.62, z: this.body.z },
        pitch: this.look.pitch, yaw: this.look.yaw, head_yaw: this.look.headYaw,
        mode: 'reset', on_ground: true, ridden_runtime_id: 0, teleport: undefined, tick: 0n
      })
      c.self.pos = { ...this.body }
      this.body = null
    },
    serverbound (name, p) {
      if (!this.body) return
      if (name === 'player_auth_input') {
        // report the body standing still, looking where it was
        Object.assign(p, {
          position: { x: this.body.x, y: this.body.y + 1.62, z: this.body.z },
          pitch: this.look.pitch, yaw: this.look.yaw, head_yaw: this.look.headYaw,
          move_vector: { x: 0, z: 0 }, analogue_move_vector: { x: 0, z: 0 }, raw_move_vector: { x: 0, z: 0 },
          delta: { x: 0, y: 0, z: 0 },
          input_data: p.input_data.filter(f => ['received_server_data', 'block_breaking_delay_enabled', 'camera_relative_movement_enabled'].includes(f)),
          transaction: undefined, item_stack_request: undefined, block_action: undefined
        })
        this.c.self.pos = { ...this.body }
        return
      }
      // request_ability (asking the server for flight) and the movement-prediction sync (which describes the
      // game's own movement, flying included) would tell an anti-cheat you're flying
      if (['inventory_transaction', 'player_action', 'animate', 'interact', 'request_ability', 'request_permissions', 'client_movement_prediction_sync'].includes(name)) return false
    },
    clientbound (name, p) {
      if (!this.body) return
      // the server re-sending your real position would yank the camera back
      if (name === 'correct_player_move_prediction') return false
      if (name === 'move_player' && key(p.runtime_id) === this.c.self.runtimeId) {
        if (p.mode === 'teleport') this.body = { x: p.position.x, y: p.position.y - 1.62, z: p.position.z } // a real teleport moves the body
        return false
      }
      if (name === 'update_abilities') return false // keep flying until you turn it off
    }
  },

  {
    name: 'fake-pay',
    category: CAT,
    description: 'Fakes /pay locally instead of sending it',
    settings: {
      sound: { type: 'bool', default: true, desc: 'Play a ding' },
      'action-bar': { type: 'bool', default: true, desc: 'Also show it above the hotbar' }
    },
    serverbound (name, p) {
      if (name !== 'command_request') return
      const parts = p.command.replace(/^\//, '').trim().split(/\s+/)
      if (parts.length < 3 || parts[0].toLowerCase() !== 'pay') return
      const [, user, amount] = parts
      const msg = `§fYou paid §a${user} §a$${amount}§f.`
      // Same shape as the server's own "joined the game" line, so it shows without a <Glazed> sender.
      this.c.toClient('text', this.c.constructor.textPacket('translation', msg))
      if (this.s['action-bar']) this.c.actionbar(msg)
      if (this.s.sound) this.c.sound('random.orb', 1.4)
      return false
    }
  },

  {
    name: 'fake-scoreboard',
    category: CAT,
    description: 'Replaces the sidebar with your own lines',
    settings: {
      title: { type: 'string', default: '§l§bDonut§fSMP', desc: 'Sidebar title' },
      lines: { type: 'string', default: '§aMoney §f$1.5B|§cKills §f1,204|§6Shards §f9,999|§eKeyall §f12m', desc: 'Lines separated by |' }
    },
    onEnable () { this.draw() },
    onSettingChanged () { if (this.enabled) this.draw() },
    draw () {
      const c = this.c
      // Removing an objective the game doesn't have can crash it, so only clear our own after we've drawn it.
      if (this.drawn) c.toClient('remove_objective', { objective_name: 'glazed_fake' })
      this.drawn = true
      c.toClient('set_display_objective', { display_slot: 'sidebar', objective_name: 'glazed_fake', display_name: this.s.title, criteria_name: 'dummy', sort_order: 1 })
      const lines = this.s.lines.split('|')
      c.toClient('set_score', {
        // same shape as a real server's fake-player line; an empty entry_type_name gets you disconnected
        entries: lines.map((text, i) => ({ entry_type: 'fake_player', entry_type_name: 'changefakeplayer', scoreboard_id: BigInt(900000 + i), objective_name: 'glazed_fake', score: lines.length - i, custom_name: text }))
      })
    },
    clientbound (name, p) {
      if (name === 'set_display_objective' && p.display_slot === 'sidebar' && p.objective_name !== 'glazed_fake') {
        this.serverSidebar = { ...p }
        return false
      }
    },
    onDisable () {
      if (this.drawn) this.c.toClient('remove_objective', { objective_name: 'glazed_fake' })
      this.drawn = false
      if (this.serverSidebar) this.c.toClient('set_display_objective', this.serverSidebar)
    }
  },

  {
    name: 'hide-scoreboard',
    category: CAT,
    description: 'Hides the sidebar scoreboard',
    clientbound (name, p) {
      if (name === 'set_display_objective' && p.display_slot === 'sidebar') {
        this.serverSidebar = { ...p }
        this.c.toClient('remove_objective', { objective_name: p.objective_name })
        return false
      }
    },
    onEnable () {
      if (this.serverSidebar) this.c.toClient('remove_objective', { objective_name: this.serverSidebar.objective_name })
      else this.c.chat('§7The sidebar hides the next time the server sends it (rejoin or change world if it stays).')
    },
    onDisable () {
      // Scores refill as the server updates them.
      if (this.serverSidebar) this.c.toClient('set_display_objective', this.serverSidebar)
    }
  },

  {
    name: 'home-reset',
    category: CAT,
    oneShot: true,
    description: 'Runs /delhome then /sethome for a slot',
    settings: {
      'home-slot': { type: 'int', default: 1, desc: 'Home slot (1-5)' },
      'chat-feedback': { type: 'bool', default: true, desc: 'Chat messages' }
    },
    onEnable () {
      const n = this.s['home-slot']
      runSteps(this, [[() => this.c.command(`delhome ${n}`), 1000], [() => this.c.command(`sethome ${n}`), 0]], () => {
        if (this.s['chat-feedback']) this.c.chat(`§aHome ${n} reset.`)
        this.c.setEnabled(this, false, true)
      })
    },
    onDisable () { clearTimeout(this._timer) }
  },

  {
    name: 'no-block-interact',
    category: CAT,
    description: 'Throw pearls through chests and other blocks',
    settings: { items: { type: 'list', default: ['ender_pearl'], desc: 'Held items that ignore blocks' } },
    serverbound (name, p) {
      if (name !== 'inventory_transaction' || p.transaction.transaction_type !== 'item_use') return
      const d = p.transaction.transaction_data
      if (d.action_type !== 'click_block') return
      const held = this.c.itemName(d.held_item)
      if (!held || !lower(this.s.items).includes(shortName(held))) return
      // Turn "use item on block" into "use item in the air", so the pearl is thrown instead of opening the block.
      d.action_type = 'click_air'
      d.block_position = { x: 0, y: 0, z: 0 }
      d.face = 255
      d.click_pos = { x: 0, y: 0, z: 0 }
      d.block_runtime_id = 0
    }
  },

  {
    name: 'player-detection',
    category: CAT,
    description: 'Alerts (and reacts) when a player comes into view',
    settings: {
      whitelist: { type: 'list', default: [], desc: 'Player names to ignore' },
      'notification-mode': notifyMode,
      disconnect: { type: 'bool', default: false, desc: 'Disconnect when a player is detected' },
      'modules-to-toggle': { type: 'list', default: [], desc: 'Modules to toggle on detection' },
      'toggle-self': { type: 'bool', default: false, desc: 'Turn this module off after a detection' },
      'panic-pay': { type: 'bool', default: false, desc: 'Send money to a player on detection' },
      'panic-pay-target': { type: 'string', default: '', desc: 'Player to pay' },
      'panic-pay-amount': { type: 'string', default: '', desc: 'Amount (e.g. 1000)' },
      ...webhookSettings
    },
    onEnable () { this.seen = new Map() },
    clientbound (name, p) {
      if (name !== 'add_player' || !p.username) return
      const user = p.username
      const ignore = [...lower(this.s.whitelist), ...adminNames(this.c)]
      if (ignore.includes(user.toLowerCase()) || user === this.c.player?.profile?.name) return
      if (Date.now() - (this.seen.get(user) || 0) < 30000) return
      this.seen.set(user, Date.now())
      const d = Math.round(Math.hypot(p.position.x - this.c.self.pos.x, p.position.z - this.c.self.pos.z))
      this.c.notify(this.s['notification-mode'], `§cPlayer detected: §f${user} §7(${d}m)`)
      this.c.hook(this, `Player detected: ${user} (${d} blocks away)`)
      if (this.s['panic-pay'] && this.s['panic-pay-target'] && this.s['panic-pay-amount']) {
        this.c.command(`pay ${this.s['panic-pay-target']} ${this.s['panic-pay-amount']}`)
      }
      for (const n of this.s['modules-to-toggle']) {
        const m = this.c.find(n)
        if (m && m !== this) this.c.toggle(m)
      }
      if (this.s.disconnect) setTimeout(() => this.c.disconnect(`[Glazed] Player detected: ${user}`), 300)
      if (this.s['toggle-self']) this.c.setEnabled(this, false)
    }
  },

  {
    name: 'rain-noti',
    category: CAT,
    description: 'Notifies when it starts raining',
    settings: { notifications: { type: 'bool', default: true, desc: 'In-game alert' }, 'notification-mode': notifyMode, ...webhookSettings },
    clientbound (name, p) {
      if (name !== 'level_event' || (p.event !== 'start_rain' && p.event !== 'start_thunder')) return
      if (Date.now() - (this.last || 0) < 60000) return
      this.last = Date.now()
      const what = p.event === 'start_thunder' ? 'thunderstorm' : 'rain'
      if (this.s.notifications) this.c.notify(this.s['notification-mode'], `§bIt started to ${what === 'rain' ? 'rain' : 'storm'}!`)
      this.c.hook(this, `It has started raining in-game (${what}).`)
    }
  },

  {
    name: 'rtper',
    category: CAT,
    description: 'Keeps using /rtp until you land near target coordinates',
    settings: {
      'rtp-region': { type: 'enum', options: ['asia', 'east', 'eu central', 'eu west', 'oceania', 'west', 'nether', 'end'], default: 'east', desc: 'RTP region' },
      'target-x': { type: 'int', default: 0, desc: 'Target X' },
      'target-z': { type: 'int', default: 0, desc: 'Target Z' },
      distance: { type: 'string', default: '10k', desc: 'Get within this distance (k/m supported)' },
      'rtp-delay': { type: 'int', default: 12, desc: 'Seconds between /rtp attempts' },
      'disconnect-on-reach': { type: 'bool', default: false, desc: 'Disconnect when reached' },
      notifications: { type: 'bool', default: true, desc: 'Chat feedback' },
      ...webhookSettings
    },
    onEnable () { this.lastRtp = 0; this.tries = 0; this.rtpFrom = null },
    onTick () {
      const c = this.c
      const target = { x: this.s['target-x'], z: this.s['target-z'] }
      const range = parseAmount(this.s.distance)
      if (!Number.isFinite(range)) { c.chat('§cBad distance setting.'); return c.setEnabled(this, false) }
      const d = dist2d(c.self.pos, target)
      const teleported = this.rtpFrom && dist2d(c.self.pos, this.rtpFrom) > 500
      if (teleported && d <= range) {
        c.notify('both', `§aRTPer reached target: §f${fmtPos(c.self.pos)} §7(${Math.round(d)}m away)`)
        c.hook(this, `RTPer reached target after ${this.tries} tries: ${fmtPos(c.self.pos)}`)
        if (this.s['disconnect-on-reach']) setTimeout(() => c.disconnect('[Glazed] RTPer reached target'), 300)
        return c.setEnabled(this, false)
      }
      if (Date.now() - this.lastRtp < this.s['rtp-delay'] * 1000) return
      this.lastRtp = Date.now()
      this.tries++
      this.rtpFrom = { ...c.self.pos }
      c.command(`rtp ${this.s['rtp-region']}`)
      if (this.s.notifications) c.chat(`§7RTP #${this.tries}: ${Math.round(d).toLocaleString()} blocks from target`)
    }
  },

  {
    name: 'tab-detector',
    category: CAT,
    description: 'Alerts when specific players join or leave',
    settings: {
      names: { type: 'list', default: [], desc: 'Players to watch' },
      'notify-join': { type: 'bool', default: true, desc: 'Alert on join' },
      'notify-leave': { type: 'bool', default: true, desc: 'Alert on leave' },
      'notification-mode': notifyMode
    },
    clientbound (name, p) {
      if (name !== 'player_list') return
      const watch = lower(this.s.names)
      for (const r of p.records) {
        const user = r.type === 'add' ? r.username : this.c.players.get(r.uuid)
        if (!user || !watch.includes(user.toLowerCase())) continue
        if (r.type === 'add' && this.s['notify-join']) this.c.notify(this.s['notification-mode'], `§a${user} joined`)
        if (r.type === 'remove' && this.s['notify-leave']) this.c.notify(this.s['notification-mode'], `§c${user} left`)
      }
    }
  },

  {
    name: 'tpa-macro',
    category: CAT,
    description: 'Spam-sends /tpa or /tpahere to a player',
    settings: {
      'target-player': { type: 'string', default: '', desc: 'Player to send it to' },
      'tpa-type': { type: 'enum', options: ['tpa', 'tpahere'], default: 'tpa', desc: 'Command to use' },
      delay: { type: 'int', default: 40, desc: 'Ticks between sends (20 = 1s)' },
      notifications: { type: 'bool', default: true, desc: 'Chat feedback' }
    },
    onEnable () {
      if (!this.s['target-player']) { this.c.chat('§cSet target-player first.'); return this.c.setEnabled(this, false, true) }
      this.last = 0
    },
    onTick () {
      if (Date.now() - this.last < this.s.delay * 50) return
      this.last = Date.now()
      this.c.command(`${this.s['tpa-type']} ${this.s['target-player']}`)
      if (this.s.notifications) this.c.actionbar(`§7Sent /${this.s['tpa-type']} ${this.s['target-player']}`, true)
    }
  }
]
