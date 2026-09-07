# Validation log

The local PAL PS2 extraction contains 24 disc files and 18,754 entries from 11 RCF archives. The original ISO was only read.

## September 7, 2026

- TypeScript and Vite production build passed. The combined renderer/game bundle still produces a size warning.
- Player motion tests verify equal movement at 120 Hz rendering over 60 Hz physics, shortest-path heading interpolation, and teleport resets.
- Traffic tests verify continuous motion over road gaps, right-angle junctions and dead-end turns, plus 120 Hz interpolation.
- Fence contact tests verify that a separating vehicle does not receive another bounce or damage.
- A browser driving sample after the player/grass changes recorded frame p95 of about 18–25 ms and maximum grass work below 0.4 ms. This is a local sample, not a cross-device performance guarantee.
- The scenery converter completed 100 scene files and 1,630 texture entries. Full visual comparison and performance validation of this pass are ongoing.
- Campaign resources have been compiled, but full campaign playthrough validation has not yet occurred.

The earlier seven-map rendering/menu/save checks predate the latest scenery and traffic changes. These checks do not establish 1:1 behavior with the original game.
