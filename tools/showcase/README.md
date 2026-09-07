# Showcase capture

These tools capture the actual web renderer at 1920×1080 and assemble a 50-second H.264 video with the original Sunday Drive music.

The capture build is an isolated copy under `artifacts/showcase/capture`. Camera moves, driving inputs and character positions are staged for filming. Road traffic is cleared for the driving takes. None of those filming controls is added to the playable build.

```sh
python3 tools/showcase/prepare.py
npm --prefix artifacts/showcase/capture run dev -- --port 5177
```

Open the printed address. In the Showcase director, use **Prepare shot** to check a composition, **Record shot** for a single take, or **Record all shots** for the sequence. The renderer advances in fixed 1/30-second steps while capturing, so a slower capture does not become a choppy or slow-motion export. The visible completion message confirms that every frame was saved.

Frames are written to `artifacts/showcase/raw`. A repeated take replaces that shot's previous frames. Inspect the footage before assembling it:

```sh
python3 tools/showcase/edit.py
```

The edit writes the video, poster, clean stills and shot metadata to `docs/media`. It requires FFmpeg with libx264 and Pillow. The title font defaults to Arial Rounded Bold on macOS; change the font paths at the top of `edit.py` on another platform.

The video is a showcase of a work in progress. Staged camera footage does not establish a full mission playthrough or parity with the PS2 game.
