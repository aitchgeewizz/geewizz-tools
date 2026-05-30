# Reel v2: Build Brief

Builds on `briefs/reel.md`. Three new capabilities:
1. Accept MP4 and GIF input alongside images, each as a single tile
2. Add transition styles (crossfade, ping-pong, hold ends)
3. Export MP4 in addition to GIF

Shipped in three stages so each can be tested before the next lands.

---

## Architecture change: tiles can be images or videos

In v1, every frame was an image rendered to a canvas at the target size and aspect. In v2 the frame list becomes a tile list, and tiles come in two kinds:

- **Image tile**: same as before. One canvas, one frame in the output. Held for the Frame duration slider.
- **Video tile**: a clip with native duration. Decoded once into a cached sequence of canvases. Held in the output for its native duration.

GIFs are treated as videos in this model. They have a native frame sequence and a duration. Same UI, same code path.

### New control: Video playback fps

Segmented control: `2 / 4 / 8 / 12 fps`. Default 8.

Only shown when the tile list contains at least one video or GIF. Controls the playback rate of video tiles in the encoded output. Higher = smoother + bigger file.

Image tiles continue to use the Frame duration slider.

### Encoded sequence

When the user hits Download, the encoder walks tiles in order. For each tile:

- Image: one encoded frame with delay = Frame duration slider value
- Video: each cached frame written with delay = `1000 / videoFps` ms

GIF supports per-frame delay natively. MP4 will be re-timed at the encoder fps.

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
- Soft warning if a single video tile is longer than 8 seconds (= 96 cached frames). Suggest trimming.
- Hard cap at 200 cached frames per video. Anything longer is truncated with a warning.

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

Holding back so v2 ships:
- Ken Burns slow zoom on each image
- Slide-in transitions with direction control
- Per-frame duration overrides
- Target size mode for GIF
- Reverse toggle
- Trim controls for video tiles
- WebCodecs decode for MP4 input (faster than video-element seeking)
- A separate Slice tool for extracting individual frames from a video (different product, different brief)

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
