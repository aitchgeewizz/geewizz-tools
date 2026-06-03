# Reel v3: Build Brief

Builds on `briefs/reel-v2.md` (which shipped). v3 covers per-tile control and any precision features that the global controls can't reach.

Shipped in stages. This brief covers Stage 1 in detail. Later stages get noted as parking-lot for now and will get their own briefs when prioritised.

---

## Stage 1: Per-tile reframing

### The problem

Images come in different aspect ratios. The global Fit / Background controls do the right thing for the average tile but the wrong thing for specific images where the subject is off-centre. A portrait headshot on a 16:9 canvas in Cover mode crops the top of the head. A wide product shot may chop the meaningful left or right edge. You want the output canvas locked but the framing per-image.

### Scope

Each tile gets two new optional overrides:

1. **Fit override**: `Use default` (follow the global Fit control) / `Cover` / `Contain`
2. **Anchor point**: a 3×3 grid (top-left, top-centre, top-right, middle-left, centre, middle-right, bottom-left, bottom-centre, bottom-right). Determines which part of the image is preserved when Cover crops, or where the image sits within the letterbox when Contain leaves space. Default centre, matches current behaviour.

Together these cover most "the crop is wrong" cases. Want the face at the top? Anchor top-centre with Cover. Want a wide product shot to keep its right edge? Anchor middle-right with Cover.

### UI: selected-tile sidebar (Option B)

- Click a tile to select it. Selected tile gets an accent border.
- A `Tile settings` sidebar appears beside the frames grid showing:
  - A small preview of how the tile currently crops at the chosen canvas size and aspect
  - Fit override segmented control: `Default / Cover / Contain`
  - 3×3 anchor grid as nine clickable squares with the active one filled accent
  - Close button (×) to deselect
- Click another tile to switch the sidebar focus
- Click the close × or empty space to deselect

Sets up a clean pattern for any per-tile control we add in later stages (per-tile transition, per-tile Ken Burns direction, per-tile bg colour, per-tile duration).

### Tech notes

Each tile gets new properties:
- `tile.fitOverride: null | 'cover' | 'contain'` (null = use global)
- `tile.anchor: 0-8` (3×3 grid, default 4 = centre)

`renderSourceToCanvas(src, w, h, tile)` becomes tile-aware. `drawCover` and `drawContain` take anchor coordinates (`ax`, `ay`) so the crop or letterbox offset is anchor-driven instead of always centred. When a tile's fit or anchor changes, only that tile re-renders (not all of them), then the preview sequence rebuilds.

For video / GIF tiles, the anchor applies to each cached frame uniformly.

### Done definition

- Click a tile, sidebar appears with current settings and a preview
- Change Fit override, that tile re-renders with the new mode, all other tiles unchanged
- Change anchor, that tile re-crops accordingly. Preview canvas and the tile thumbnail both update.
- Close button or selecting another tile dismisses / switches cleanly
- Sidebar collapses gracefully on narrow screens

---

## Stage 2 (parking lot — not in this brief)

- Drag-to-reposition: pixel-level pan on the sidebar preview by dragging the source
- Per-tile zoom: scale the source up before anchoring
- Per-tile background colour (Contain only)
- Per-tile transition overrides (which transition leads into / out of this tile)
- Per-tile Ken Burns direction picker (override deterministic)
- Per-tile durations (each tile its own time)
- Trim controls for long video tiles
- Target filesize mode for GIF / MP4
- Slice as a separate tool (extracts every frame from a video)
