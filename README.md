# Glazed Bedrock

A utility client for **Minecraft Bedrock**, built from [Glazed](https://github.com/realnnpg/glazed)'s DonutSMP modules.
It runs as a proxy: Minecraft connects to it, it connects to DonutSMP, and the modules work by reading and changing packets in between.
Nothing is injected into the game, so game updates don't break it. You only update `bedrock-protocol` when the network version changes.

Glazed's code is "All Rights Reserved", so none of it is copied here. Every module was rewritten from scratch to do the same job on Bedrock.

## Setup

1. Install [Node.js](https://nodejs.org) (the LTS version).
2. Unzip this folder anywhere and double-click **`start.bat`**. The first run installs what it needs, which takes about a minute.
3. Leave that window open while you play.

(Developers can use `npm install`, then `npm start`.)

In Minecraft: **Play → Servers → Add Server**, address `127.0.0.1`, port `19134`. Join it.

- **First join:** you're kicked with a Microsoft sign-in code (it's also printed in the console). Open the link, enter the code, and rejoin. The login is saved in `auth/`. Keep that folder private.
- **"Outdated client/server":** your game is newer than the protocol version this was built for (`1.26.51`). Run `npm install bedrock-protocol@latest`, then set `"version"` in `config.json` to your game version.
- **Can't connect on an older Windows (UWP) version of the game:** run this once in an admin terminal:
  `CheckNetIsolation LoopbackExempt -a -n="Microsoft.MinecraftUWP_8wekyb3d8bbwe"`
- **Phone or console:** set `"proxy": { "host": "0.0.0.0" }` in `config.json`, then add your PC's LAN IP as the server.

`config.json` (created on first run) stores the server address, the command prefix and every module's settings.

## Using it

Type commands in chat. They're never sent to the server.

| Command | What it does |
|---|---|
| `.gui` | Opens the menu (or use the bind: double-tap sneak by default; change it with `.set click-gui bind double-sneak/double-jump/emote/off`) |
| `.bind <module>` | Then use any emote: that emote now turns the module on/off (it never plays or reaches the server). One emote per module, up to 8 with a full emote wheel. Also in each module's settings |
| `.unbind <module>` / `.binds` | Remove a bind / list them |
| `.server <address> [port]` | Switches which server you join (also in the menu under Server). Leave and rejoin to switch |
| `.t <module>` | Flips a module on or off |
| `.on <module> [more...]` / `.off ...` | Switches one or more modules on or off |
| `.set <module> <setting> <value>` | Changes a setting (lists are comma-separated) |
| `.get <module>` | Shows a module's settings |
| `.list` | Lists all modules (green = on) |
| `.panic` | Turns every module off |
| `.region` | Shows your DonutSMP region |
| `.exploittest` | Fakes a malicious server against your own game to test Anti Exploit |

Module names ignore dashes: `.t playerdetection` works.

## Modules

### Main
| Module | What it does on Bedrock |
|---|---|
| Admin List | Staff names that Player Detection ignores |
| Admin Hud | Alerts when watched staff join or leave/vanish; shows who's online above the hotbar |
| AH Sell | Lists every hotbar item with `/ah sell <price>` |
| Emergency Seller | Lists chosen hotbar items (and slot 1) for `1b` |
| Coord Snapper | Copies your coordinates to the clipboard, plus optional webhook |
| Fake Pay | `/pay` is caught and faked locally, so no money is sent |
| Glazed Freecam | Fly the camera freely, through blocks; the server sees you standing still. Turning it off puts you back. `speed` sets fly speed |
| Fake Scoreboard | Replaces the sidebar with your own lines (`|`-separated) |
| Hide Scoreboard | Hides the sidebar |
| Home Reset | `/delhome N` then `/sethome N` |
| No Block Interact | Pearls are thrown through chests and other blocks instead of opening them |
| Player Detection | Alerts when a player comes into view; optional webhook, disconnect, panic pay and module toggles |
| Rain Noti | Alerts (and webhook) when it starts raining |
| RTPer | Repeats `/rtp <region>` until you land within a distance of target X/Z |
| Tab Detector | Alerts when specific players join or leave |
| TPA Macro | Repeats `/tpa` or `/tpahere` to a player |

### ESP
A proxy can't draw boxes or lines. Instead, every ESP target gets:

- **A floating name tag** that shows through walls.
- **A colored waypoint dot on the Locator Bar** at the top of the screen (`waypoint`, on by default). Mob dots follow the mob. Block dots are capped at 16 per module.
- **A small alert above the hotbar** (`alert`: `actionbar`, `chat`, `both` or `off`). Several finds at once queue up.
- Optional **Discord webhook**.

There are also two optional extras, both off by default:

- **`tracers`:** a dotted particle line to the 8 nearest targets. Particles don't show through walls.
- **`tracer-arrow`:** an arrow above the hotbar pointing to the nearest target.

Blocks that were already loaded when you switch an ESP on are found too.

| Module | What it finds |
|---|---|
| Spawner Notifier | Spawners, tagged with their mob |
| Advanced Stash Finder | Chunks with many chests, barrels, shulkers etc. (+ webhook, auto disconnect) |
| Block Notifier | Any block entity you list (Beacon, Conduit, Bell, ...) |
| Beehive ESP | Hives and nests with their bee count |
| Collectible ESP | Item frames (with the item) and banners |
| Piston ESP | Pistons and sticky pistons |
| Llama / Pillager / Villager / Wandering ESP | Those mobs |
| Drowned Trident ESP | Drowned holding a trident |
| Player ESP | Red tag with live distance on every player, plus an alert when one comes into view |
| Invis ESP | Makes invisible players and mobs visible (including ones that were already invisible) |
| Region Map | Your DonutSMP region and continent above the hotbar |

### Protection
**Anti Exploit** is on by default. It runs before every other module and stops crash and lag packets from reaching your game:

- **Forms:** server forms over 30k characters are blocked, and form spam is capped at 3 per second.
- **Text:** chat lines, titles and name tags are cut short, and translation bombs are blocked.
- **Floods:** particles, sounds and new entities are each capped per second.
- **Bad positions:** NaN, infinite or far-away positions and extreme velocity are dropped. Knockback on you is scaled down instead of dropped.
- **Transfers:** you're told when the server moves you to another address (that connection skips this client); you can choose to block it.
- **Malformed packets:** these are dropped instead of reaching the game.

Every limit is a setting. Commands sent by macros are also spaced at least 350 ms apart, so they don't trigger spam kicks.

**Testing it:** type `.exploittest` in chat. It fakes a malicious server and sends a set of attack packets through the same path real server packets take, then reports how many got through. With Anti Exploit on, you should see "Blocked: …"; a few normal forms still get through because the form limit allows them. Run `.t anti-exploit` to switch it off and compare. With it off, your game really receives the junk, which can lag it.

**The sign keybind check:** this is a Java Edition check. Geyser hands Bedrock players signs as plain text, and this client adds no keybinds or translation keys to the game, so there's nothing for it to find.

### Performance
| Module | What it does |
|---|---|
| No Particles | Drops particles sent by the server (explosions, crits, spells) |
| Chunk Limiter | Caps render distance below what the game asks for |
| No Weather | Hides rain and thunder (Rain Noti still works) |

A proxy can't change how the game renders. For the biggest FPS gains, change these in **Settings → Video**: render distance 8–12, simulation distance 4, Fancy Graphics off, Beautiful Skies off, Smooth Lighting off, Fancy Leaves off, Particle Render Distance low, V-Sync off, and Ray Tracing / Vibrant Visuals off.

### Not possible in a proxy
These Glazed modules need to control the game itself (mouse, camera, rendering, or clicking items in chest menus), so they need an injected client:

- **Menu clicking:** Auto Sell, Ah Shield Seller, Auto Spawner Sell, Emergency Order, Inv Sell, Iron Ah Restocker, Order Dropper, Shulker Dropper, Spawner Dropper, Spawner Order, Storage Stealer, and TPA Macro's confirm click.
- **Movement, aim or mining:** Auto Pearl Chain, Premium Tunnel Base Finder, Spawner Protect, and every PvP module (Anchor Macro, Anti Trap, Auto Double Hand, Auto Inv Totem, Crystal Macro, Hover Totem, Key Pearl, Lunge Macro, Shield Breaker).
- **Reading every block:** Chunk Finder, 1x1x1 Holes, Covered Hole, Hole Tunnel Stairs, Deepslate, Rotated Deepslate, Dripstone, Kelp, Vine, Sweet Berry, Light, Amethyst, Bedrock Void ESP, and RTPer's biome mode. Block IDs depend on the server's palette, so only block *entities* are read.
- **Rendering:** Skeleton ESP.

## Testing

```bash
npm test
```

Runs the module logic and the malicious-packet tests offline, and round-trips every packet the client builds through the real protocol encoder.

**Testing in-game before joining DonutSMP:** singleplayer worlds run inside the game, so a proxy can't sit in front of them. Use Microsoft's free [Bedrock Dedicated Server](https://www.minecraft.net/download/server/bedrock) (same version as your game) instead:

1. Unzip it. In `server.properties`, set `online-mode=false`, `allow-list=false` and `transport=raknet` (newer servers default to NetherNet, which the proxy can't use). Then run `bedrock_server.exe`.
   Or run `node tools/local-server.js`, which starts it and ops every player who joins, so `/summon` and `/setblock` work.
2. Start the proxy in local mode: `node src/index.js --local` (add `--debug` to log packets to `proxy-debug.log`). No Microsoft sign-in is needed.
3. Optional: `node tools/esp-test-zone.js <your name>` builds one of every ESP target around you.
4. Join `127.0.0.1` port `19134` from the **Servers** tab and try the modules, including `.exploittest`.

**Test bot:** `node tools/bot.js [name]` joins through the proxy as an offline player you control from the terminal:

- **Chat:** type a message to send it.
- **Client commands:** type them with a dot, like `.gui` or `.t fake-pay`.
- **Server commands:** type them with a slash, like `/list`.
- **Forms:** answer with `!form <button>`, `!form true`/`false` for yes-no forms, or `!form close` to close one.
- **Other:** `!pos` shows the bot's position, `!quit` leaves, and `!help` lists all controls.

The proxy takes one player at a time. To have your game and the bot online together, add `--direct` so the bot joins the server directly. It then counts as "another player" for testing Player Detection, Tab Detector and Admin Hud.

## Sharing

Run `npm run pack` to make `dist/glazed-bedrock.zip`. It **leaves out** your `auth` folder (your Microsoft login: never share it), your `config.json`, and `node_modules`. Each friend signs in with their own account on first join.

## License

GPL-3.0 (see `LICENSE`). The DonutSMP region layout comes from Larper Client, which is GPL-3.0. Everything else was written from scratch for Bedrock; no Glazed code is included.

> Use at your own risk. DonutSMP runs an anti-cheat, and automation is against many servers' rules.
