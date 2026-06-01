# Reel v2: Build Brief

Builds on `briefs/reel.md`. Three new capabilities:
1. Accept MP4 and GIF input alongside images, each as a single tile
2. Add transition styles (crossfade, ping-pong, hold ends)
3. Export MP4 in addition to GIF

Shipped in three stages so each can be tested before the next lands.

---

## What actually shipped (post-implementation summary)

Status: **shipped**. A few things diverged from the original plan during implementation. Headline differences:

- **No "Video playback fps" control.** Originally proposed but removed during Stage 1 iteration. Videos always play at real-time (1x) at a fixed 10 fps internal rate.
- **Video speed segmented control** was added later, then removed in favour of the unified-then-split tile duration model below.
- **Tile duration model evolved.** Final shape: two separate sliders, `Image duration` and `Video duration`, both 0.1s-5.0s. Stills hold for their slider; videos play at real-time for their slider duration, with the last frame held to fill the slot if the video is shorter and a trim if longer.
- **Source video cap** reduced from 8s to 5s to match the slider max.
- **Motion polish (Stage 2.5) was added.** Six transitions (Cut, Fade, Slide, Push, Zoom, Blur) with proper easing baked in, plus Ken Burns slow pan + zoom on still tiles.

The rest landed close to plan. See sections below for the original brief content, kept as historical reference.

---

## Architecture change: tiles can be images or videos

In v1, every frame was an image rendered to a canvas at the target size and aspect. In v2 the frame list becomes a tile list, and tiles come in two kinds:

- **Image tile**: same as before. One canvas, one frame in the output. Held for the Frame duration slider.
- **Video tile**: a clip with native duration. Decoded once into a cached sequence of canvases. Held in the output for its native duration.

GIFs are treated as videos in this model. They have a native frame sequence and a duration. Same UI, same code path.

### No Video playback fps control

Earlier drafts proposed a Video playback fps control. Removed during Stage 1 because it confused the timing model. Videos now always play at real speed (1x) at a fixed internal rate (10 fps). Image tiles continue to use the Frame duration slider.

The fixed 10 fps internal rate is a compromise between smoothness and GIF file size. Encoded as 100ms delay per video frame.

### Encoded sequence

When the user hits Download, the encoder walks tiles in order. For each tile:

- Image: one encoded frame with delay = Frame duration slider value
- Video: each cached frame written with delay = 100ms (= 10 fps real-time playback)

GIF supports per-frame delay natively. MP4 will be re-timed at a constant 10 fps base, with image frames stretched to occupy their slider duration.

---

## Stage 1: Video tile input

### Scope
- Accept MP4 and GIF in the drop zone
- Decode and cache frames once at a fixed internal rate (12 fps) at the current canvas dimensions
- Show video tiles as: first frame as poster, play triangle icon top-left, duration label bottom-right
- New "Video playback" control (2/4/8/12 fps, default 8), shown only when video tiles present
- Encoder samples cached frames at the chosen output fps when walking the sequence
- Existing GIF output path supports mixed image and video tiles

### Decode strategy
- MP4: load into a hidden `<video>` element, seek to each timestamp at internal rate, draw frame to canvas. Reliable across browsers, no extra deps.
- GIF: use `gifuct-js` (~15KB) via jsdelivr +esm to decode all frames at once.

### Decode cache
Each video tile holds an array of canvases at the current target dimensions. When Size or Aspect or Fit changes, re-render all cached frames at the new dimensions (same as image tiles).

The cached frames are at the internal max rate (12 fps). The output fps samples this set: at 8 fps it takes every other frame from a 12 fps cache, at 4 fps every third, etc. No re-decode needed when the user changes Video playback fps.

### Limits
- Hard auto-trim: videos longer than 8 seconds are clipped to the first 8 seconds at decode time. The tile shows `(cut)` next to its duration, and the warning bar names the file. This is the "drop in whatever, the tool optimises" philosophy. v3 may add explicit trim controls so you can pick a portion.
- 80 cached frames per video (8 seconds at 10 fps internal).

### Tile UI
- Same square aspect grid
- Poster image fills the tile, same as image tiles
- Play triangle (10x10 SVG, accent colour) top-left corner inside a small dark backing
- Duration label bottom-right: `3.2s` in JetBrains Mono, white text on dark backing
- × on hover same as image tiles

### Filesize estimate updates
Now factors in video frame count too. For each video tile, `(nativeFrames at chosen output fps) × pixelCost × paletteCost`.

---

## Stage 2: Transitions

### New controls
- `Transition` segmented: `Cut / Crossfade`. Default Cut.
- `Loop` segmented: `One way / Ping-pong`. Default One way.
- `Hold ends` checkbox. Default off.

### Crossfade
Insert 3 intermediate frames between each pair of consecutive tiles. Each intermediate is an alpha-blended composite of the last frame of tile A and the first frame of tile B at increasing opacity steps (0.25, 0.5, 0.75). Each intermediate held for the same delay as the cut frame would have used, divided by 4.

Works for any tile pair: image-image, image-video, video-video.

### Ping-pong
After building the forward encoded sequence, append it in reverse with the first and last frames removed (to avoid doubling). Applies after transitions, so crossfade frames are included in the reverse pass.

### Hold ends
Multiply the first and last frames' delay by 1.5x. For video tiles at the start or end, hold the first frame (start) or last frame (end) at 1.5x its normal delay.

### Filesize estimate
Factors in intermediate frames from Crossfade and doubled frame count from Ping-pong.

---

## Stage 3: MP4 output

### New control
- `Format` segmented next to the Download button: `GIF / MP4`. Default GIF.

When MP4 is selected, button reads "Download .mp4". If WebCodecs isn't supported in the user's browser, MP4 button is disabled with a tooltip: "Your browser doesn't support MP4 export. Try Chrome, Edge, or Safari 16+. GIF works everywhere."

### Encode strategy
- WebCodecs `VideoEncoder` for H.264 frames
- `mp4-muxer` (~30KB) via jsdelivr +esm to assemble the MP4 container
- Render each encoded frame canvas to a `VideoFrame`, feed to encoder, get back chunks, mux to MP4 blob

### Quality maps to bitrate
- Punchy: 1 Mbps
- Balanced: 3 Mbps
- Pristine: 6 Mbps

### Frame rate
MP4 uses a fixed encoder fps. For consistency:
- Encoder fps = the user's Video playback fps if videos present, otherwise = `1000 / frame duration` rounded.
- This means MP4 plays at the same speed as the GIF preview.

### Filesize estimate for MP4
Different formula: `bitrate × duration / 8`. Roughly accurate within 20%.

---

## v3 parking lot

Updated after v2 shipped. Crossed-out items have already landed.

- ~~Ken Burns slow zoom on each image~~ (shipped in Stage 2.5b)
- ~~Slide-in transitions with direction control~~ (shipped in Stage 2.5a, plus Push, Zoom, Blur)
- **Per-tile duration overrides** (each tile its own duration in addition to the global Image / Video sliders)
- **Per-tile Ken Burns direction picker** (override the deterministic move pattern)
- **Per-tile transition overrides** (different transition between specific pairs)
- **Trim controls for video tiles** (pick which portion of a long video to include rather than just the first 5s)
- **Target size mode for GIF** (type "3 MB", tool iterates settings to hit it)
- **Reverse toggle** (whole reel plays backward)
- **WebCodecs decode for MP4 input** (faster than the current video-element seeking)
- **Slice** as a separate tool (extracts every frame from a video, different product entirely)

---

## Tech notes summary

New CDN deps, all via jsdelivr +esm:
- `gifuct-js` for GIF decode (~15KB)
- `mp4-muxer` for MP4 encode (~30KB)
- WebCodecs (native browser API)

Lesson from v1: never import named exports from esm.sh, use jsdelivr +esm instead.

---

## Done definition per stage

### Stage 1
- Drop an MP4 of any browser-supported codec, see a video tile appear with poster + duration
- Drop a GIF, same behaviour
- Mix images and videos in the tile list, reorder them
- Hit Download and get a GIF that plays the images and videos in order
- Video playback control changes how smooth the video bits look in the output

### Stage 2
- Transition to Crossfade makes consecutive tiles fade into each other
- Loop to Ping-pong makes the reel play forward then backward
- Hold ends adds extra dwell time on the first and last frame

### Stage 3
- Toggle output to MP4 on a supported browser, get a .mp4 file that plays in QuickTime
- Toggle output to MP4 on an unsupported browser, see the disabled state with the tooltip
- Quality affects bitrate, files are noticeably smaller than the GIF equivalent
