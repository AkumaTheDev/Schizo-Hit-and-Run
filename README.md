# Hit & Run in the browser

A Three.js reconstruction of The Simpsons: Hit & Run using assets converted from a local PS2 disc image. It runs without PS2 emulation. It is a work in progress, with free roam working and campaign integration under development.

The public repository contains the application and conversion tools. **You need your own game disc image to play.** Game artwork, audio, scripts, movies, extracted archives, and generated assets are excluded from Git. This is an unofficial project, with no affiliation to the original developers or rights holders.

## Build and play locally

Install Node.js 24+, Python 3.11+, 7-Zip (`7zz`), FFmpeg with AAC/IPU support, and Blender 5.1+. The conversion has been tested against the PAL PS2 disc; other releases have not been verified.

```sh
git clone https://github.com/Vheissu/hit-and-run-web.git
cd hit-and-run-web
npm ci
python3 -m pip install -r requirements.txt
npm run extract -- --iso '/path/to/your/Hit and Run.iso'
npm run convert
npm run campaign:convert
npm run remaster
blender --background --factory-startup --python tools/campaign_cars.py
blender --background --factory-startup --python tools/scenery_remaster.py
npm run dev -- --port 5174
```

Open the address printed by Vite. The server binds to `127.0.0.1`. Asset conversion takes time and several gigabytes of disk space. The input ISO is only read.

On macOS, `npm run remaster` detects `/Applications/Blender.app`. Set `BLENDER_PATH` for another installation. For the two direct Blender commands, use your Blender executable's full path if it is not on `PATH`.

Press Start, then New Game. Escape opens the pause menu. Options contains the level, vehicle, lighting and rendering settings.

| Control | Action |
| --- | --- |
| W A S D / arrows | Drive or move on foot |
| Space | Handbrake or jump |
| E | Enter or leave your vehicle |
| Shift | Run on foot |
| C | Change camera |
| B | Look behind |
| H | Cruise at 50 km/h |
| R | Return to the road and repair |
| M | Zoom radar |
| P | Hide/show HUD |
| Escape | Pause/resume |
| F3 | Frame timings and diagnostics |

Touch driving controls and standard gamepad steering/triggers are available. Full gamepad menu navigation remains unfinished.

## Current work

- Seven level variants and five player characters, with original geometry, character animations, UI artwork, bitmap fonts, and the animated living-room menu.
- Driving, walking, road traffic, coins, vehicle damage, local saves, and an added five-stop time trial.
- Interpolated player and NPC motion, continuous junction paths, and grass placement spread across frames.
- A Blender scenery pass over 100 exterior/interior files: preserved UVs and baked colors, rounded hard edges, and 11 surface-detail material classes covering 1,630 textures. Enlarging source artwork does not recover missing detail; signs and illustrations still retain their original designs and resolution limits.
- A campaign compiler that reads the original mission scripts, locators, objectives, conditions and rewards. Dialogue, mission vehicles, NPCs, props, and all 16 movies can be converted locally. The campaign runtime is being connected to gameplay.

This is not yet a 1:1 port. Vehicle handling and traffic are reconstructed systems. Original police behavior, gags, destructible props, collectible-card gameplay, menu parity and complete campaign behavior still need work and verification. The original executable is not being recompiled.

## Tests

```sh
npm run test:unit  # Runs without game assets
npm run build
npm test           # Also checks locally converted assets
```

CI builds the code and runs tests that do not require game data. Local asset checks cover extracted archives, geometry, collision datasets, skin weights, UI resources, textures, and Blender vehicle exports. The production build currently has a bundle-size warning.

## Format references

- [Donut Team Pure3D documentation](https://docs.donutteam.com/docs/Pure3DFiles/Intro)
- [Donut Team mission command documentation](https://docs.donutteam.com/docs/TheSimpsonsHitAndRun/Scripting/ConsoleCommands/AllCommands)
- [Hampo's LuaP3DLib](https://github.com/Hampo/LuaP3DLib)
- [Luigi Auriemma's Radcore archive documentation](https://aluigi.altervista.org/bms/atg_core_cement.bms)
- [PS2SDK VIF documentation](https://ps2dev.github.io/ps2sdk/group__packet2__vif.html)

Original project code is available under the MIT license. That license does not grant rights to the original game or its assets.
