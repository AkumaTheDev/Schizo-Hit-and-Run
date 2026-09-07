# Validation log

The local PAL PS2 extraction contains 24 disc files and 18,754 entries from 11 RCF archives. The original ISO was only read.

## September 7, 2026

- TypeScript and Vite production build passed. The combined renderer/game bundle still produces a size warning.
- Player motion tests verify equal movement at 120 Hz rendering over 60 Hz physics, shortest-path heading interpolation, and teleport resets.
- Traffic tests verify continuous motion over road gaps, right-angle junctions and dead-end turns, plus 120 Hz interpolation.
- Fence contact tests verify that a separating vehicle does not receive another bounce or damage.
- A browser driving sample after the player/grass changes recorded frame p95 of about 18–25 ms and maximum grass work below 0.4 ms. This is a local sample, not a cross-device performance guarantee.
- The scenery converter completed 100 scene files and 1,672 texture entries, including composite world objects previously omitted by the converter. The pass contains 1,707,576 triangles and 1,388 bevelled parts. All 100 collision buffers are byte-for-byte identical to their converted source buffers.
- The full suite passes 51 TypeScript tests and five Python format tests. The campaign checks cover all 610 stages from 89 mission scripts with valid objective events, resource availability, timers, ordered race checkpoints, multi-lap races, wager fees, checkpoint loading, mission and chapter progression, and bonus rewards.
- Browser checks completed the opening tutorial with objective-position assistance, original dialogue, vehicle entry, Kwik-E-Mart entry and return to the next mission. Further scenario checks verified visible power couplings, kick destruction, the 1/9 counter, checkpoint retry, an original three-lap circuit and its race-failure condition. A circuit driving sample recorded 56 FPS, frame p95 25.0 ms and maximum grass work 0.1 ms. These assisted checks are not a full campaign playthrough.
- The original opening movie, mission briefing art and recorded dialogue render/play in the browser. Player movement and road traffic use interpolation; scripted vehicle routes now round corners and use distance-based movement.
- The Pages build removes duplicate original scene buffers from the deployment only. The prepared site is approximately 928 MB; the repository retains the original converted buffers alongside the remastered versions.

The earlier seven-map rendering/menu/save checks predate the latest scenery and traffic changes. These checks do not establish 1:1 behavior with the original game.
