# Imex hologram artwork

## Continuous movie revision

`imex-assembly.webm` records the current continuous 9.6-second assembly plus
its final hold as one 960×810 video. The live website renders the same sequence
with `ParticleAssembly.tsx`. Following the supplied movie frames, a compact cyan
cloud rises from a lower chest emitter, builds the left shoulder and cranium,
travels over the crown, and finishes the right side. 11,000 image-sampled motes
deposit one fixed portrait; a soft reveal follows their arrival. There are no
sprite-frame swaps or particle resets between the six progress labels. The
emitter fades as the red-orange forehead core activates, and ambient cyan dust
continues moving after assembly. Replay resets the energy field immediately.
Speech-driven lips remain interactive on the site, using the same final frame
as the assembly so the mouth does not change position at completion.


## Animated particles and speech revision

`imex-stages-v3.png` is the current sheet. Static particle dust is removed from
the final frame. `LiveEnergy.tsx` renders 1,100 moving motes. `TalkingMouth.tsx`
deforms the original portrait's lip texture using the ElevenLabs playback clock
and per-character speech timings from `speechMotion.ts`.

Edited with the built-in image generation tool using this prompt:

Edit this 3x2 six-stage cyan holographic portrait sprite sheet. Make ONLY ONE change: remove ALL scattered cyan/blue particle specks and particle dust from the bottom-right tile (sixth frame), including particles around the head, neck, shoulders AND particles on top of the face and chest. Reconstruct the clean underlying cyan horizontal contour lines wherever dust obscured them. The application will render moving particles at runtime. Keep the sixth frame's subject identity, exact scale, framing, human face, neck, shoulders, fine cyan contour lines, cyan silhouette edge glow, and ALL gold neural branches in the neck and chest. Keep the dark navy background. Do not add orange light in the face or forehead. Preserve tiles1,2,3,4,5 unchanged. Preserve exact 1672x941 canvas size, 3 equal columns and 2 equal rows, all frame registration, layout and visual style. No text, labels, numbers, or borders.

## Live energy revision

`imex-stages-v2.png` is the current portrait sheet. The orange light is no
longer embedded in the face image. `LiveEnergy.tsx` draws the core at 50% of
portrait width and 20.5% of portrait height, inside the upper cranium. It
animates neurons, drifting particles, and pulses according to voice state.

Edited with the built-in image generation tool using this prompt:

Edit this existing 3-column by 2-row six-stage hologram sprite sheet. Make ONLY this change: remove ALL orange/amber/gold energy glow, bright point, and warm light from the FACE and HEAD in the bottom three tiles (tiles4,5,6). Reconstruct the missing clean cyan horizontal face contours underneath so these three faces match the clean cyan face in tile3. There must be NO orange point between the eyes, NO orange glow on the nose, NO orange lighting in the eyes or forehead. Do NOT add a new light anywhere: the application will render its own dynamic orange energy source later. PRESERVE absolutely everything else: exact canvas resolution and 3x2 layout, no borders, identical pixel framing/registration, subject identity, all cyan head/face/neck/shoulder contour lines, dark navy background, all cyan particles, and especially KEEP all existing GOLD NEURAL BRANCHES in the NECK and CHEST in tiles5 and6. Tiles1,2,3 must stay unchanged. Keep the faces anatomically realistic and preserve the original line artwork. No text or numbers.

## Original artwork

`imex-stages-v1.png` is a 3-column, 2-row image sheet generated with the built-in
image generation tool using the user's six-stage image as the visual reference.
The website blends one tile into the next, preserving the portrait's framing.

Generation prompt:

Use case: stylized-concept. Asset type: production animation sprite sheet for an AI assistant hologram on a website. IMPORTANT reference selection: among the attached recent images, the ONLY desired reference is the 3-column by 2-row sheet numbered 1,2,3 / 4,5,6 showing a cyan human holographic bust that progressively assembles. The other images of a long oval featureless face or flat vector mask are FAILED OUTPUTS and must NOT guide the new artwork. Primary request: recreate the desired six-stage holographic portrait VERY CLOSELY, with an anatomically believable handsome neutral adult human face, narrow defined nose, realistic almond eye sockets, sculpted cheekbones and jaw, balanced cranium, short neck flowing organically into broad sloping shoulders, drawn in densely spaced fine horizontal cyan light contours. Reproduce the composition, proportions and warm golden core of the numbered reference. Deliver ONE high-resolution 3x2 sprite sheet, all SIX equal tiles perfectly edge-to-edge with NO borders, NO labels, NO text or numbers anywhere. Each tile shows EXACTLY THE SAME IDENTICAL subject silhouette, scale, camera and pixel registration, centered and front-facing, from crown to upper chest. SAME subject in all cells, not six different faces. Portrait fills 88% tile height, top margin8%, shoulders extend to bottom edge; head 34% tile width and54% tile height. Pure uniform very dark navy background #020d18 in every cell. Tile1 (top left): ONLY thin glowing cyan outer silhouette head neck shoulders, empty dark interior. Tile2 (top middle): identical silhouette plus fine horizontal cyan contour lines smoothly following featureless curved head, neck and shoulders. Tile3 (top right): identical contours now wrap realistic human facial relief, visibly defined brows, eyes, nose, cheekbones, lips and chin; fine intricate horizontal lines that reveal the human face, no flat cartoon facial symbols, no eyeballs drawn on top. Tile4 (bottom left): exact tile3 face plus softly radiant circular amber-orange energy sphere centered between eyes and nose, small white-gold pinpoint heart, detailed warm filaments, facial contours still visible over glow. Tile5 (bottom middle): exact tile4 plus elegant organic branching gold neural filaments under jaw through neck to clavicles and upper chest. Tile6 (bottom right): exact tile5 plus extremely fine densely sprinkled cyan particle dust hugging silhouette crown neck and shoulders, delicate cinematic edge glow. Style: sophisticated photorealistic holographic line sculpture, high detail cyan wire contours on near-black navy, fine thin clean lines, not vector illustration, not cartoon, no stretched alien skull or long neck, no thick tubing, no flat mask. Target closely the numbered six-stage reference. Keep every tile aligned for smooth crossfade animation.
