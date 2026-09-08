# Native executable findings

The [vehicle, walking and coin investigation](MOVEMENT_PHYSICS.md) adds native force rules, jump timing, source road lanes and interactive world objects.

The later [pursuit and traffic investigation](PURSUIT_PARITY.md) adds address-grounded meter, police, traffic and character-palette findings, together with the implemented behavior and remaining differences.

The Kwik-E-Mart fall came from missing wall collision. Its floor had been converted, but the separate static physics objects had not. Walking backwards from the entry crossed the visible back wall, left the finite floor and dropped Homer into the void. This was reproduced in the browser before the fix.

The investigation used both the original Pure3D files and a Ghidra analysis of the disc's executable. The assembly and decompiler output are stored locally under `artifacts/native/`; the original files are unchanged. These are selected function exports from a stripped executable. They do not recover the original C++ project.

## Executable and analysis setup

| Field | Observed value |
| --- | --- |
| Boot target | `SLES_518.97`, from `SYSTEM.CNF` |
| Size | 3,886,492 bytes |
| SHA-256 | `e936793df537c2764fae6908d52bbbcbc41606080855f1a26751ffb28bfbfa47` |
| Format | ELF32, little-endian MIPS, entry `0x00100008` |
| Main code | `0x00100000` through `0x0041f900` exclusive |
| Symbols | No `.symtab`; `.mdebug.eabi64` is empty |
| Ghidra | 12.1.3, Java 21, native macOS ARM decompiler built locally |
| Processor extension | Emotion Engine Reloaded 2.1.37 |
| Selected language | `r5900:LE:32:default`, default compiler specification |

The initial bounded export produced 24 functions. Four targeted passes produced 134 exports covering 119 distinct addresses in the physical main-code range, with zero export failures. Those passes followed interior strings, the collision-loader vtable and primitive constructors. Successful decompilation does not establish that every inferred type or control-flow edge is correct.

Ghidra also found cached/uncached address aliases, so its initial count of 14,203 eligible functions is not a count of unique game functions. Nine DVP overlay-analysis skips and false-positive PNG detections appeared during import. VU coverage and the rest of the game remain outside this check.

## Address-grounded findings

| Address | Evidence | Use in the reconstruction |
| --- | --- | --- |
| `0x00159098` | References `InteriorEntryEnd` at `0x0045a680`; obtains the locator, copies its position and transform, and calls a placement routine. The surrounding branches depend on several readiness flags. | Keep the source entry locator and finish loading the room before placing the player. The meanings of every flag have not been recovered. |
| `0x00156da8`, `0x00157030` | Reference `InteriorOrigin` at `0x0045a610`. | Distinguish interior origins from player entry destinations. |
| `0x002cb7c8` | Reached through the `CollisionObjectLoader` vtable at `0x00483284`; dispatches chunk `0x07010001` to `0x002cbed8`. | Load physics objects separately from terrain intersection triangles. |
| `0x002cbed8` | Reads the volume header, switches on primitive IDs `0x07010002`–`0x07010006`, then recursively reads the declared number of child volumes. | Preserve the hierarchy during decoding; emit solid leaves for the browser solver. |
| `0x002ce390` | Cylinder constructor stores length, radius, axis and flat-end flag. Instructions `0x002ce454`–`0x002ce484` choose `sqrt(length² + radius²)` for flat ends or `length + radius` for rounded ends. | Treat length as the distance from the center to an end, and flag zero as rounded caps. |
| `0x002ce828` | Box initializer stores three dimensions and axes; its bounding radius is `sqrt(x² + y² + z²)`. | Use the dimensions as half extents, preserving each box's orientation. |

The browser does not implement the native collision solver. It uses the decoded shapes with a Three.js capsule solver and short movement steps. Cylinders and spheres are approximated by triangle meshes. The player's body dimensions remain reconstruction values. The later movement pass replaces walking, jumping and gravity defaults with values traced through the executable.

## Interior data and the fix

The 19 source interior files contain 427 box leaves, 43 cylinder leaves and 17 sphere leaves beneath static physics entities. All 43 cylinders have rounded ends. Aggregate volumes enclose descendants; turning those enclosing boxes into solid geometry would block entire rooms. The exporter rejects unsupported leaves or mismatched child counts instead of silently dropping them.

`tools/interiors.py` writes one collision JSON file per room and a manifest with source hashes and counts. Coordinates follow the same Z reflection as the scene converter. Runtime box construction uses a right-handed basis so reflected boxes retain outward triangle winding. Ground triangles receive upward winding for the capsule solver; the existing terrain buffers are unchanged.

The level-one Kwik-E-Mart back wall has center `(500.0677, -18.2671, 306.6714)` and half extents `(10.8817, 2.5, 0.8374)` after conversion. The player starts at `(499.3860, -20, 304.2430)`. Its near face is at about `z=305.834`, so the 0.35-radius player body stops near `z=305.484`, within reach of the exit trigger.

Regression checks start at every original interior entry, approach each exit, and sprint in eight directions. The reported Kwik-E-Mart route also runs at 60 Hz and 15 Hz with a jump into the wall. Exit locators can lie behind a solid door face, so reachability is checked from the playable side of the door rather than by spawning inside it.

## Repeat the targeted export

Install Ghidra and a matching [Emotion Engine Reloaded extension](https://github.com/chaoticgd/ghidra-emotionengine-reloaded), then import the supplied executable with language `r5900:LE:32:default`. Keep the generated project outside git. For the existing local project:

```sh
"$GHIDRA_HOME/support/analyzeHeadless" artifacts/native/initial/project ps2-analysis \
  -process SLES_518.97 -noanalysis -max-cpu 2 \
  -scriptPath tools/native \
  -postScript InspectNative.java tools/native/interior-targets.txt artifacts/native/interior
```

Repeat with `collision-targets.txt` and `shape-targets.txt` into separate output directories. The script exports physical-code roots and direct callees, with an 80-function selection limit and a 20-second decompiler limit per function. Each output contains assembly, pseudocode and a JSON report of successes and failures. Addresses here apply only to the executable hash above.
