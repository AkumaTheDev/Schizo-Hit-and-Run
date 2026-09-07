# From a PS2 disc to a browser tab

This started with a PAL PlayStation 2 disc image and the idea of driving around Springfield in a browser. The result is a Three.js reconstruction of *The Simpsons: Hit & Run*, built from converted game assets and new browser code.

The PS2 executable doesn't run here. This project reads the game's data and rebuilds the systems needed to use it. That distinction matters: the characters, places, dialogue and mission scripts come from the original game, but the renderer, controls, physics and mission runtime are new implementations.

## Getting the data out

The disc extraction produced 24 files. Eleven Radical RCF archives contained another 18,754 entries: models, textures, animations, scripts, sound and other resources. The extraction tools read the ISO without changing it.

Much of the art uses Pure3D. Some geometry is packed into PS2 VIF vertex data, so there was no simple “export to glTF” step. The converters decode the geometry, rebuild object transforms, resolve shared textures and write buffers that Three.js can load. Character conversion also reconstructs skeletons, skin weights and animation tracks.

Composite objects needed particular attention. A world object can refer to a drawable through several layers of wrappers and skeleton transforms. Missing those references left scenery out of the early build, including the power couplings used in a story mission. The converter now follows those references, and mission destructibles remain separate from the static rendering batches.

## Keeping the game's identity

The first playable build used custom menus and a custom HUD. That lost a big part of the original game's identity. The interface was rebuilt around its Scrooby artwork, bitmap fonts and layout data, including the animated living-room menu, radar and mission briefings.

The briefing pictures had their own wrinkle: they were tiled sprites, rather than ordinary texture entries. Reassembling those tiles recovered 55 original briefing images. Recorded conversations and the PS2 movies were converted separately into browser-playable audio and video.

## Rebuilding the campaign

The MFK scripts provide the campaign's structure. A compiler reads their commands, resolves locators and looks up mission titles and objectives in the original text bible. The browser runtime then handles conversations, travel objectives, races, deliveries, purchases, failure conditions and progression.

The current data contains 89 scheduled mission entries and 610 stages across seven chapters, including the tutorial, story missions, bonus missions, races and chapter transitions. Automated checks exercise every compiled stage with valid objective events. Browser checks cover selected missions, interiors, retries, saves and chapter transitions; a complete playthrough of every mission is still outstanding.

## The scenery pass

Blender was used to process 100 exterior and interior scene files. The pass preserves the original UVs and baked vertex colours, adds small bevels to suitable hard edges, and supplies surface detail for materials such as roads, brick, wood and metal. Vehicle models received a separate Blender pass.

The original collision buffers are preserved byte for byte. Enlarged textures still have the limits of their source artwork: a small painted sign doesn't acquire new illustrated detail just because its image is bigger. The aim was to improve how the existing art reads in a modern renderer while keeping Springfield recognisable.

Filming the showcase caught another rendering error: signs were upside down even though the image files were correct. The world-texture upload was flipping them vertically. Fixing that also meant keeping character-atlas settings separate, so shared texture caching would not change the characters’ colours.

## Making it move and load

The visible rubber-banding came from several places. Rendering now interpolates between physics steps, cars follow continuous paths through road junctions, and grass placement is spread across frames. Contact with a fence no longer repeatedly bounces a car that is already moving away from it.

Codex handled the reconstruction and conversion work in this project. Claude contributed loading improvements, including WebP textures and concurrent asset downloads. Both were used with the actual files, source scripts, browser checks and build output; this wasn't generated from screenshots of the game.

There is still work to do on original police behaviour, gags, collector-card gameplay and handling parity. The project is public so people can play the current build, report what breaks and contribute to the reconstruction.
