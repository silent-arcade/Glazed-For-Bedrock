# How to use Glazed Bedrock

Glazed Bedrock is a utility client for **Minecraft Bedrock** (Windows), made for **DonutSMP**. It runs as a small program next to your game: Minecraft connects to it, and it connects to the server. Nothing is installed into Minecraft, so game updates don't break it.

## How it works (the "proxy")

```
Minecraft  ⇄  Glazed Bedrock (on your PC, 127.0.0.1:19134)  ⇄  DonutSMP
```

Normally Minecraft talks straight to DonutSMP. With Glazed Bedrock, it talks to a small program on your own PC instead. That program passes everything on to DonutSMP and back, so you play normally, but it can **read, add, change or hold back** messages on the way:

- **Reads:** it sees what the server sends (players nearby, spawners, chests, rain…), which is how alerts and ESP find things.
- **Adds:** it can add things only you see: the menu, chat lines, the sidebar, floating tags, particle beams, night vision.
- **Changes or holds back:** it can change or hold back what your game sends. Fake Pay keeps `/pay` from going out, and Freecam tells the server you're standing still while you fly.

What it **can't** do: draw on your screen (no boxes or lines through walls), press keys or move your mouse, click items in chest menus, or see every block in the world. That's why ESP uses tags and beams, and why binds use emotes and sneak/jump.

---

## 1. One-time setup (about 5 minutes)

1. **Install Node.js.** Go to <https://nodejs.org>, download the **LTS** version and install it with the default options.
2. **Download Glazed Bedrock.** On the GitHub page open **Releases** and download `glazed-bedrock.zip`. Unzip it somewhere easy to find, like `Documents\Glazed Bedrock`.
3. **Start it.** Double-click **`start.bat`**. The first time, it installs what it needs, which takes about a minute. When you see `Glazed Bedrock proxy on 127.0.0.1:19134 -> donutsmp.net:19132`, it's ready. **Keep this window open while you play.**
4. **Add the server in Minecraft.**
   - Go to **Play → Servers** (the **Servers** tab, not Friends) and click **Add Server**.
   - Name it **Glazed**, set the address to **`127.0.0.1`** and the port to **`19134`**, then save.
5. **Sign in once.**
   - **Get the code:** join **Glazed**. The first time you're kicked with a **Microsoft sign-in code**, also shown in the black window.
   - **Sign in:** open <https://www.microsoft.com/link>, enter the code, and sign in with your Minecraft account. Wait until the page says you're signed in.
   - **Rejoin:** join **Glazed** again. You won't be asked again on this PC.

## 2. Every time you play

1. Double-click **`start.bat`** and leave the window open.
2. In Minecraft, join **Glazed**.
3. After loading, chat shows **`<Glazed> Loaded. Type .gui for the menu…`**. You're in DonutSMP with the client running.

## 2b. Turning it off

- **Turn off just the cheats, stay connected:** type `.panic` (or press **Turn everything off** in the menu). Every module switches off and you keep playing through the client.
- **Stop the client:** close the black `start.bat` window, or click it and press `Ctrl + C` (if it asks `Terminate batch job (Y/N)?`, press `Y` then Enter). You're kicked with "Glazed Bedrock was closed".
- **Still connected after closing it?** Another copy is running in the background. Open **Task Manager** (`Ctrl + Shift + Esc`), find **Node.js JavaScript Runtime**, and click **End task** (end all of them).
- **Play without it:** join DonutSMP from your normal server list (`donutsmp.net`, not the **Glazed** entry). Nothing is installed in Minecraft, so with the window closed the game is 100% normal.
- **Start again later:** double-click `start.bat` and join **Glazed**.
- **Remove it completely:**
  - Delete the **Glazed** server entry in Minecraft (hold or right-click it, then Delete).
  - Delete the Glazed Bedrock folder. That also deletes your saved login (`auth`) and settings.
  - To be extra sure, sign out of other devices at <https://account.microsoft.com/security>.

## 3. The menu

**Open it:** type **`.gui`** in chat, or **double-tap sneak** (you can change this bind, see section 5).

If you open it from chat, the menu appears as soon as you close the chat screen.

- **Main screen:** one button per category (Protection, Main, ESP, Render, Client, Performance), showing how many modules are on. Below those:
  - **Enabled modules:** everything that's on, in one list.
  - **Server:** change which server you join.
  - **Turn everything off:** panic button.
- **Category screen:** every module has an on/off switch. Flip as many as you like and press **Submit**. To change a module's options, pick it under **"Open settings for"** at the bottom before submitting.
- **Settings screen:** the module's options, plus **Bind** at the bottom (see section 5). Press **Submit** to save. Settings are remembered for next time.

## 4. Chat commands

Everything starting with a dot stays on your PC. The server never sees it.

| Command | What it does |
|---|---|
| `.gui` | Open the menu |
| `.on <module>` / `.off <module>` | Turn modules on/off. Several at once: `.on fullbright nametags` |
| `.t <module>` | Flip a module (`.t freecam on` also works) |
| `.list` | List all modules (green = on) |
| `.get <module>` | Show a module's settings |
| `.set <module> <setting> <value>` | Change a setting, e.g. `.set rtper target-x 5000` |
| `.bind <module>` / `.unbind <module>` / `.binds` | Emote binds (section 5) |
| `.server <address> [port]` | Join a different server next time (section 6) |
| `.region` | Your DonutSMP region |
| `.panic` | Turn every module off |
| `.exploittest` | Check the crash protection (section 7) |

Module names work with or without dashes: `.on playerdetection` = `.on player-detection`.

## 5. Binds

Minecraft only tells the client about *actions* (jump, sneak, emotes), not individual keys. So binds use actions, and you can put those actions on any key in **Settings → Keyboard & Mouse** in Bedrock.

**Opening the menu.** Pick one with `.set click-gui bind <choice>`:
- `double-sneak` (default): tap sneak twice. Tip: bind Sneak to Right Shift.
- `double-jump`: tap jump twice.
- `emote`: press your emote key (default **B**) and pick any emote. The menu opens instead of the emote.
- `off`: only `.gui` opens it.

**Turning any module on/off with an emote.** Each emote in your emote wheel can be a bind, so a full wheel gives you up to 8:
1. Type `.bind freecam`, or open the module's settings and choose **Bind to an emote**.
2. Press your emote key and pick an emote. Chat confirms the bind.
3. From now on, using that emote turns Freecam on/off. The emote never plays and the server never sees it.

## 6. Switching servers

- In the menu: **Server**, then enter the address and port.
- Or in chat: `.server play.example.net` (add the port if it isn't 19132).

Then leave and join **Glazed** again; you'll land on the new server. To go back: `.server donutsmp.net`.

## 7. The modules

### Protection
- **Anti Exploit** (always on): blocks crash and lag tricks such as huge forms, text bombs, particle/sound/entity floods, broken positions and extreme knockback. A short "Blocked: …" note appears when it stops something. Run `.exploittest` to watch it work.

### Main (DonutSMP)
- **AH Sell**: lists every hotbar item on `/ah` at the `price` you set.
- **Emergency Seller**: panic-lists chosen items (and slot 1) for 1b.
- **Admin List**: staff names that other modules treat specially.
- **Admin Hud**: alerts when listed staff join or vanish, and shows who's online.
- **Player Detection**: alerts when a player comes near. Optional: webhook, auto-disconnect, panic `/pay`, toggling other modules.
- **Tab Detector**: alerts when specific players join or leave.
- **Rain Noti**: alerts when it starts raining.
- **RTPer**: repeats `/rtp` until you land near `target-x` / `target-z`.
- **Home Reset**: `/delhome` + `/sethome` in one go.
- **TPA Macro**: repeats `/tpa` (or `/tpahere`) to a player.
- **Coord Snapper**: copies your coordinates to the clipboard (and an optional webhook).
- **No Block Interact**: throw pearls through chests instead of opening them.
- **Fake Pay**: `/pay` is faked on your screen only. **No money is sent while it's on.**
- **Fake Scoreboard**: your own sidebar text (set `title` and `lines`, lines separated by `|`).
- **Hide Scoreboard**: hides the sidebar.
- **Glazed Freecam**: see below.

**Freecam, step by step:**
1. Walk a step first, then `.on glazed-freecam`.
2. Double-tap jump to start flying. Hold jump to rise and sneak to sink.
3. `noclip` is on, so you can fly **through blocks and under the ground** to look for bases. Underground looks like X-ray: you see the hollow spaces (caves, rooms, tunnels).
4. `.off glazed-freecam` puts you back where you started.

While Freecam is on, the server sees you standing still at that spot, and your clicks are held back. Use `.set glazed-freecam speed 3` for faster flying.

### ESP (finding things)
Each one puts a **floating tag** on what it finds and a **light beam** on the nearest few. A short **alert** appears above the hotbar too.
- **Block tags** (spawners, chests…) show a live distance.
- **Mob tags** are set the moment the mob appears and can't change after that, because the game ignores later changes. So **switch an ESP on before you go looking**: mobs that were already around get the alert and beam, but no tag.
- **Spawner Notifier**: spawners, with the mob type.
- **Advanced Stash Finder**: chunks with lots of chests, barrels or shulkers. Set the count with `min-storage`.
- **Block Notifier**: block types you choose (beacons, conduits…).
- **Beehive ESP**, **Collectible ESP** (item frames, banners), **Piston ESP**.
- **Llama / Pillager / Villager / Wandering ESP**: those mobs, with a tag on the mob.
- **Drowned Trident ESP**: drowned holding a trident. Alert and beam only, because the trident is only known after the mob has appeared.
- **Player ESP**: red name tag on players as they come into view, plus an alert. For live distance over players, use **Nametags**.
- **Invis ESP**: makes invisible players and mobs visible. Switch it on before they turn invisible or come into view.
- **Region Map**: your DonutSMP region above the hotbar.

Every ESP has these options in its settings:
- `alert`: where the found-it message shows: `actionbar` (small, default), `chat`, `both` or `off`.
- `waypoint`: the distance on the tag plus the beam.
- `tracers`: a dotted particle line to targets, with `tracer-particle` to change its look.
- `tracer-arrow`: an arrow above the hotbar pointing to the nearest target.
- `locator-bar`: dots on the top-of-screen Locator Bar.
- Discord webhook settings.

### Render
- **Nametags**: a big tag over every player with name, distance and held item (staff marked), plus tags on dropped items (`Dirt x3`).
- **Fullbright**: see in the dark. It's night vision that only your game knows about.

### Client
- **Click GUI**: the menu bind (section 5).

### Performance
- **No Particles**: hides server particles (explosions, crits).
- **Chunk Limiter**: caps render distance. Set it with `.set chunk-limiter radius 8`.
- **No Weather**: hides rain and thunder.

For the biggest FPS gains, also lower these in **Settings → Video**: render distance, fancy graphics, beautiful skies and particles.

## 8. Troubleshooting

| What you see | Fix |
|---|---|
| `Failed to bind server … is the port free?` | Glazed is already running in another window (or in the background). Close the extra window, or end **Node.js JavaScript Runtime** in Task Manager. |
| Nothing happens when joining **Glazed** | Make sure the black window is open and shows "proxy on 127.0.0.1:19134". |
| No `<Glazed> Loaded` in chat | You joined DonutSMP directly (or from the Friends tab). Join the **Glazed** entry (`127.0.0.1` port `19134`). |
| Kicked with a sign-in code every time | Finish signing in on the Microsoft page **before** rejoining. Wait until it says you're signed in. |
| Kicked with a reason from the server | The reason is the server's own; it's also shown in the black window. |
| "Outdated client/server" | Your Minecraft is newer than the client. Update the client (download the newest release). |
| Menu doesn't appear after `.gui` | It opens once you close the chat screen. |
| A tag is missing on a block | The block above it is solid (tags can't show inside blocks), or the chunk is still loading: wait 5 seconds. |
| Something else | Run `start.bat`, reproduce it, and send the text from the black window. |

## 9. Stay safe

- **Never share your `auth` folder.** It holds your Microsoft login. Every friend signs in with their own account.
- **Server rules:** DonutSMP has an anti-cheat, and automation breaks many servers' rules. Use the client at your own risk.
- **Fake Pay:** while it's on, `/pay` doesn't send real money.
