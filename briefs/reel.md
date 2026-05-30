# Reel: Build Brief

The second tool in Geewizz Tools. Drop a bunch of images, get a looping GIF back. Same shape as Squish.

---

## 1. The problem

Hannah wants to showcase work as a quick looping GIF without having to hunt for a tool every time. The friction is real: most browser-based GIF makers want a login, push you into editing screens, or feel cheap. The tools that don't are buried inside design apps and overkill for a 5-second sequence.

Reel is the same trick as Squish: drop images in, get useful output back, no fuss.

---

## 2. Core flow

1. Drop or click to add images. Folders allowed. Same drop zone behaviour as Squish.
2. Thumbnails appear in the order they were added. Drag to reorder. Hover for a small × to remove a frame.
3. Pick the three controls: Size, Quality, Frame duration. Plus aspect ratio + fit mode.
4. Live preview canvas loops at the top of the page, updates as soon as you change anything.
5. Filesize estimate sits next to the preview so you can see the trade-off as you tweak.
6. Hit Download, get a `.gif`.

That's the loop. Everything else is a dial.

---

## 3. v1 scope

### Aspect ratio
Buttons: `1:1`, `16:9`, `9:16`, `3:4`, `Custom`. Custom shows two number inputs for W×H.
**Default: 1:1.** Works on every social platform.

### Fit mode
- `Cover`: fill the canvas, crop overflow. Default. Right answer most of the time.
- `Contain`: fit the whole image, letterbox the rest.

### Background (only for Contain mode)
Cream (`--bg`), white, or black. Default cream.

### Size (one of the two big filesize levers)
Three presets, longest side:
- `Small` — 320px
- `Medium` — 540px (default)
- `Large` — 720px

Plain language because most people don't think in pixels.

### Quality (the other big lever)
Three presets that control palette size and dithering together:
- `Punchy` — 32 colours, no dither. Tiny files. Great for UI demos, screenshots, illustration.
- `Balanced` — 128 colours, light dither. Default. Works for most photos.
- `Pristine` — 256 colours, full dither. Largest files. Photo-realistic showcases.

### Frame duration
Single slider, 0.1s to 2.0s. Default 0.5s. Applies to every frame.

### Output
GIF only in v1. Hard stop. MP4 and WebP come in v2.

### Reorder and remove
- Drag thumbnails to reorder. Use SortableJS via CDN.
- Hover a thumbnail to reveal a small × button. Click removes that frame.

### Live preview
- Persistent canvas at the top, loops through frames at the chosen duration
- Re-renders as soon as any setting changes
- Shows current frame index in the corner (`3 / 12`)

### Filesize estimate
- Sits next to the preview
- Updates after each setting change
- Roughly accurate, not exact. Real number shown after encoding.

### Soft warning
- If frame count exceeds 60: small note saying "GIFs get chunky past this point, consider trimming".
- Not a hard block.

---

## 4. v2 parking lot

Don't build these yet. Just noting so we don't accidentally build them into v1.

- Animation styles: crossfade, Ken Burns slow zoom, slide-in, ping-pong
- Per-frame duration overrides (instead of global)
- MP4 + animated WebP export via ffmpeg.wasm
- Target filesize mode ("get this under 3MB", tool iterates settings)
- Caption overlays
- Speed presets (Snappy / Showcase / Slow burn)
- Reverse toggle
- Trim controls if user drops too many frames

---

## 5. Tech notes

### GIF encoding
Use [gifenc](https://github.com/mattdesl/gifenc) via CDN. Modern, small (~20KB), fast, ESM-friendly. Better than gif.js for new builds.

```js
import { GIFEncoder, quantize, applyPalette } from 'https://esm.sh/gifenc';
```

### Encoding strategy for v1
- Encode on the main thread, but yield to the event loop between frames using `await new Promise(r => setTimeout(r, 0))`
- Keeps the UI responsive without the complexity of a Web Worker
- Move to a worker in v2 if encoding speed becomes a real problem

### Reordering
SortableJS via CDN. About 25KB. Cleaner than rolling our own HTML5 drag-and-drop for a grid.

```html
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"></script>
```

### Self-contained
Same rule as Squish: single HTML file, design tokens duplicated inline, CDN deps fine.

### Memory
Each decoded image holds a `Uint8ClampedArray` of pixels. At 720×720 RGBA, that's ~2MB per frame. 60 frames = 120MB peak. Browsers tolerate this, but it's why we soft-warn past 60.

---

## 6. Design

Mirror Squish's layout almost exactly:
- Header with `Reel.` wordmark (same intro animation, same hover squish)
- `← all tools` link top-right
- Controls row (Aspect / Fit / Size / Quality / Duration)
- Drop zone (same look as Squish, same copy pattern)
- Preview canvas + filesize estimate panel above the frames list
- Frames list (drag-reorderable grid of thumbnails with × on hover)
- Summary bar at the bottom with the Download button

Use the existing tokens. No new colours. The cream cards and surfy-blue accent stay.

---

## 7. Voice

Same as everything else. Direct, specific, Australian English, no em dashes, no corporate words.

Sample copy:
- Drop zone heading: "Drop your images here"
- Drop zone sub: "Or click anywhere. Order matters, drag to rearrange afterwards. JPEG, PNG, WebP."
- Filesize estimate label: "Estimated size"
- Soft warning past 60 frames: "GIFs get chunky past this point. Consider trimming."
- Footer: "Everything happens in your browser. Your images don't go anywhere."

---

## 8. Done definition

- Drop 5 images, get a working GIF back. Looping. Right aspect.
- Three Size/Quality combinations produce visibly different filesizes
- Drag-reorder works
- Live preview reflects every setting change within ~200ms
- File downloads with a sensible name (`reel-YYYYMMDD.gif`)
- Loads and works as a standalone HTML file if saved to desktop
- Visual parity with Squish
