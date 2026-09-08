# Validation log

The local PAL PS2 extraction contains 24 disc files and 18,754 entries from 11 RCF archives. The original ISO was only read.

## September 8, 2026

### Exterior collision correction and pursuit pass

- The earlier interior fix was incomplete. A separate fall remained outside Kwik-E-Mart: walking straight into the building crossed its missing exterior wall and reached `(213.9, -42.0, 311.0)` before entering the room. This was reproduced in the browser from the tutorial's shop objective.
- Converted 9,549 world-space static collision shapes across all seven levels: 8,345 boxes, 1,073 rounded cylinders and 131 spheres. Per-level outputs record every source file's hash. Zero conversion errors; original ground buffers remain unchanged. Flat box volumes are retained as planes. Dynamic and instanced prop physics are outside this conversion's scope.
- Added ten building regression checks: outside walking and sprint/jump tests at Kwik-E-Mart in levels 1, 4 and 7, plus eight-direction exterior entrance approaches across all seven levels. The existing 19-room floor, wall and entrance checks also pass.
- In the browser, a 3.5-second sprint into the exterior stopped at `(213.7, 5.0, 301.3)`. The door interaction entered the room and advanced to Talk to Apu. A 2.5-second sprint/jump against the back wall stayed at `(499.4, -19.9, 305.5)`. Exiting returned to `(213.7, 5.0, 300.9)`; walking away remained above the street. Objective-position assistance was used to reach the door.
- Police checks verified that kicking Marge raises heat without advancing her talk objective, a cruiser catches the player and deducts exactly 50 from 75 coins, level seven spawns two pursuit vehicles, and retry clears pursuit while preserving the remaining balance. A race's disable command prevents police spawning. Forced pursuit inside Kwik-E-Mart decays to zero without capture or coin loss. Meter and coin setup used development controls; these are assisted behavior checks.
- Nine seconds of parked-player traffic testing preserved 100% vehicle condition while adjacent traffic passed. This followed fixes to vehicle footprints, braking and collision checks along turns. A Halloween loading failure exposed three unresolved character texture references; these now resolve and all 67 character/outfit resources pass validation. There were no new browser warnings or errors after that correction.
- Nine vehicles received a Blender material, wheel and light-bar pass, including the cruiser and pursuit hearse. Exports retain source part identifiers, have finite geometry and include tagged beacon materials and tyre normal maps. The review render in [pursuit findings](docs/PURSUIT_PARITY.md) is from Blender.
- Eleven further native analysis passes exported 485 functions at 380 distinct physical-code addresses. Two requested addresses lacked recognized functions: the four-instruction traffic-group close callback was decoded manually; a vehicle-collision emitter remains unresolved. See [pursuit findings](docs/PURSUIT_PARITY.md) for the recovered rules and remaining behavior differences.
- The full local suite passes **105 TypeScript tests and nine Python tests**, with zero failures or skips. The Pages production build passes; the existing bundle-size warning remains. These checks do not establish full original-game parity.

### Earlier interior correction

- Reproduced the Kwik-E-Mart fall by entering through the tutorial objective and holding backwards for two seconds. The player crossed the back wall and fell below the original floor. The missing data was the separate static physics hierarchy.
- Converted 487 static shape leaves from all 19 interior files: 427 boxes, 43 rounded cylinders and 17 spheres. Each output records its source hash. Zero conversion errors; existing terrain buffers are unchanged.
- Added capsule collision against the original floor and solid shapes, with movement split into short steps. All 19 room-entry, exit-approach and eight-direction sprint checks pass. The Kwik-E-Mart wall/jump regression passes at 60 Hz and 15 Hz.
- The full local suite passes 73 TypeScript tests and seven Python tests. The Pages production build passes; the existing bundle-size warning remains.
- In the browser, the original entry interaction advanced to Talk to Apu. The previously failing two-second backward walk stopped at `(499.4, -19.9, 305.5)`. Sprinting and jumping into that wall also stayed on the floor. Exit, re-entry and Apu's conversation passed, advancing to the ice cream/cola objective. Objective-position assistance was used to reach the entrance and Apu. The browser reported zero warnings or errors for this run.
- Ghidra imported the PAL executable using the R5900 extension. Four targeted passes exported 119 distinct physical-code functions with zero export failures, in addition to the initial 24-function export. Collision-loader dispatch, recursive volume loading, box dimensions and rounded-cylinder dimensions were checked in the output. See [native analysis](docs/NATIVE_ANALYSIS.md) for addresses, hashes and coverage limits.

## September 7, 2026

- TypeScript and Vite production build passed. The combined renderer/game bundle still produces a size warning.
- Player motion tests verify equal movement at 120 Hz rendering over 60 Hz physics, shortest-path heading interpolation, and teleport resets.
- Traffic tests verify continuous motion over road gaps, right-angle junctions and dead-end turns, plus 120 Hz interpolation.
- Fence contact tests verify that a separating vehicle does not receive another bounce or damage.
- A browser driving sample after the player/grass changes recorded frame p95 of about 18–25 ms and maximum grass work below 0.4 ms. This is a local sample, not a cross-device performance guarantee.
- The scenery converter completed 100 scene files and 1,672 texture entries, including composite world objects previously omitted by the converter. The pass contains 1,707,576 triangles and 1,388 bevelled parts. All 100 collision buffers are byte-for-byte identical to their converted source buffers.
- The full suite passes 52 TypeScript tests and five Python format tests. The campaign checks cover all 610 stages from 89 mission scripts with valid objective events, resource availability, timers, ordered race checkpoints, multi-lap races, wager fees, checkpoint loading, mission and chapter progression, and bonus rewards.
- Browser checks completed the opening tutorial with objective-position assistance, original dialogue, vehicle entry, Kwik-E-Mart entry and return to the next mission. Further scenario checks verified visible power couplings, kick destruction, the 1/9 counter, checkpoint retry, independently addressable destructible meshes, an original three-lap circuit and its race-failure condition. A circuit driving sample recorded 56 FPS, frame p95 25.0 ms and maximum grass work 0.1 ms. A saved circuit checkpoint was loaded successfully with full vehicle health. Nuclear-waste pickup, UFO delivery, subsequent school entry and the level-two movie transition into Lisa’s chapter also passed assisted browser checks. These assisted checks are not a full campaign playthrough.
- The original opening movie and recorded dialogue play in the browser. All 55 briefing pictures are exported from their tiled Scrooby sprites, and the S-M-R-T briefing was visually verified with its Start Mission button. Player movement and road traffic use interpolation; scripted vehicle routes now round corners and use distance-based movement.
- The Pages build removes duplicate original scene buffers from the deployment only. The prepared site is approximately 928 MB; the repository retains the original converted buffers alongside the remastered versions.

The earlier seven-map rendering/menu/save checks predate the latest scenery and traffic changes. These checks do not establish 1:1 behavior with the original game.
