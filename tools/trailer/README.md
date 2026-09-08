# Action trailer capture

The recording copy uses the committed game code and shared converted assets. It keeps mission logic, traffic, police and collision running. Starting positions, initial velocities and cameras are staged for filming. The original movie excerpts and original game audio are assembled separately in the edit.

```sh
python3 tools/trailer/prepare.py
npm --prefix artifacts/showcase-v2/capture run dev -- --port 5184
```

Open the local address and use the visible Trailer director controls. **Prepare shot** loads the scene, and **Record shot** writes a take at 1920×1080, 60 fps. Simulation advances once per recorded frame, independently of disk-writing speed. A take ends only after all frames and its telemetry have been saved. New takes replace the matching folder under `artifacts/showcase-v2/raw`.

The game checkout is not instrumented. The recording build lives under `artifacts/showcase-v2/capture`; raw frames and audio work files stay outside git. Do not regenerate the capture copy while a take is running.

```sh
python3 tools/trailer/audio.py
python3 tools/trailer/edit.py
```

Audio preparation requires the local disc extraction under `source/game`; it is not needed just to record gameplay.

The editor uses explicit source ranges, moving gameplay throughout, short original cutscene excerpts, the original chase score, dialogue and impact sounds. It adds no explanatory text or static title cards. Source cuts and the game revision are recorded in `docs/media/trailer.json`.

Inspect every take before choosing its cut. Check the final MP4 for frame count, colour range, audio/video duration, loudness, clipped dialogue and bad frames around edits. The staged footage is a trailer, not a complete mission playthrough.
