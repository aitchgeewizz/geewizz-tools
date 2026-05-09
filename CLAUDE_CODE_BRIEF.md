# Geewizz Tools: Build Brief for Claude Code

A small suite of single-purpose web tools that solve specific workflow bottlenecks. Built for one person to use daily, designed so other people can fork and use them too.

This brief covers the foundational setup and the first deployment. It's not the spec for every individual tool. Tools get their own briefs as we go.

---

## 1. Goals and philosophy

**Build for one user first, share with anyone second.** The primary user is Hannah. The repo is public from day one. Anyone who likes a tool can fork the repo, run it locally, or deploy their own copy. No login walls, no signups, no analytics tracking, no friction.

**Each tool is a self-contained HTML file.** Drop a file in, get a tool. Remove a file, the tool's gone. No build step. No framework. No package.json fighting npm. The whole thing should still work if you saved a single HTML file to your desktop and double-clicked it.

**Privacy by design.** Image and file tools run entirely in the browser. Nothing uploads anywhere. AI tools (the ones that need an LLM) use a Bring-Your-Own-Key pattern. The user's API key lives in their own browser's localStorage. The repo is public so anyone can verify the code does exactly what it says.

**Aesthetic consistency.** Every tool shares the same visual language. Same fonts, same colour system, same component patterns. Squish (already built) is the reference.

**Quality bar.** Each tool should feel hand-crafted, not generic. The level of design care in `squish.html` is the floor, not the ceiling.

---

## 2. Tech stack

- **HTML, CSS, vanilla JS.** No React, no Vue, no build step.
- **Google Fonts** for typography (Bricolage Grotesque variable + JetBrains Mono).
- **JSZip** via CDN for archive downloads.
- **ffmpeg.wasm** via CDN for any future video tools (Frame, Swap).
- **Anthropic SDK** loaded via CDN for any future AI tools (Voice).
- **GitHub** for version control.
- **Vercel** for hosting and auto-deploy.
- **Optional:** custom domain `tools.geewizz.com.au` (configure later in Vercel).

No package.json needed for the static side. If we add Vercel serverless functions later, we'll add a minimal one then.

---

## 3. Repository structure

```
geewizz-tools/
├── README.md
├── index.html                  # Dashboard
├── tools/
│   └── squish.html             # Existing tool (provided)
├── shared/
│   ├── tokens.css              # Design tokens (CSS variables)
│   ├── components.css          # Shared component classes (optional later)
│   └── ai-key.js               # BYOK helper for AI tools (build when needed)
├── public/
│   └── og-image.png            # Open Graph image for sharing (placeholder fine)
├── vercel.json                 # Minimal config (mostly defaults)
└── .gitignore
```

**Important:** keep tools as fully self-contained HTML files. They can _optionally_ link to `shared/tokens.css` for consistency, but they should still work standalone if someone copies just the one file. This means the design tokens get duplicated inline. That's fine. They're tiny.

The dashboard at `index.html` _can_ link to shared CSS. It's expected to live inside the suite.

---

## 4. Design system (extracted from squish.html)

Use these tokens consistently across every tool and the dashboard.

### Colours
```css
--bg: #f4efe6;            /* warm cream page background */
--bg-card: #fbf8f1;       /* slightly lighter card surface */
--ink: #1a1816;           /* near-black text */
--ink-soft: #5a544c;      /* soft grey for secondary text */
--ink-faint: #9c948a;     /* faint grey for labels/captions */
--line: #d8cfbe;          /* tan border colour */
--accent: #4866ab;        /* surfy blue, primary accent */
--accent-soft: #dbe2ef;   /* pale blue for hover/drag states */
--accent-light: #8aa0e0;  /* lighter blue for use on dark backgrounds */
--good: #2dd4bf;          /* bright aqua, used for success backgrounds */
--good-deep: #0a6e63;     /* deep aqua, used for success text on light bg */
```

### Typography
- **Headings:** `Bricolage Grotesque` variable. Weight typically 500. Width axis 75-100. Used for all headings, large numbers, brand wordmarks.
- **Body:** `JetBrains Mono` weight 400. 14px base, 13px for secondary text, 11px for labels. Used for everything else including button labels, form fields, footnotes.

### Logo / wordmark behaviour
The dashboard wordmark and each tool's wordmark animate on load and on hover:
- Resting state: `font-stretch: 80%`, `font-weight: 400`
- On load: scrunches narrow + thin → expands wide + bold → settles to resting (1.6s with slight overshoot)
- On hover: smoothly expands to `font-stretch: 100%, font-weight: 750`
- On unhover: smoothly squishes back to resting state
- Respects `prefers-reduced-motion`.

See `squish.html` for the full implementation. It's tested and works. Reuse it.

### Layout patterns
- Max-width container around 980px, centred, with 32-48px padding.
- Generous whitespace.
- Subtle SVG grain overlay on body (see Squish for the exact filter).
- Cards use `--bg-card` background with `--line` 1px borders.
- Buttons: solid `--accent` with `--bg-card` text, or outline ghost variant.
- Drop zones: dashed border, hover state lights up with `--accent-soft` background.

### Microinteractions
- Hover transitions around 150-200ms.
- Animation timing: `cubic-bezier(0.4, 0, 0.2, 1)` for transitions, `cubic-bezier(0.34, 1.56, 0.64, 1)` for satisfying overshoots.

---

## 5. The dashboard (`index.html`)

This is the entry point at `tools.geewizz.com.au` (or the Vercel URL while custom domain isn't set up).

### Structure
- **Header:** Geewizz Tools wordmark with same squish-on-hover treatment as Squish. Subtitle in JetBrains Mono explaining what this is in one line.
- **Tools grid:** cards laid out in a responsive grid (3 columns desktop, 2 tablet, 1 mobile). Each card links to a tool's HTML file.
- **Footer:** mono text, mention everything happens locally / privacy-first / open source on GitHub link.

### Card design
Each tool card shows:
- A small inline SVG icon (single-stroke, accent colour, similar to the down-arrow in Squish)
- Tool name in Bricolage Grotesque (treat like a mini-wordmark, smaller scale of the same animation system)
- One-line description in JetBrains Mono
- Tag chips at the bottom showing relevant traits: `image`, `local-only`, `byok`, `video`, etc.

Cards should feel inviting. On hover, a subtle lift effect, accent border, or accent-soft background tint.

### Tool data
Define tools in a JS array at the top of the file so they're easy to add/remove:

```js
const TOOLS = [
  {
    name: "Squish",
    href: "/tools/squish.html",
    description: "Drag images in, get small ones out. Compress before emailing or uploading.",
    tags: ["image", "local-only"],
    icon: "<svg ...></svg>",
    status: "live"
  },
  {
    name: "Frame",
    href: "/tools/frame.html",
    description: "Drop images, get an animated GIF or MP4. Looping, timing, all the controls.",
    tags: ["image", "video", "local-only"],
    icon: "<svg ...></svg>",
    status: "coming-soon"
  },
  // etc
];
```

Tools with `status: "coming-soon"` render slightly faded with a "soon" tag and don't link anywhere. This lets the dashboard show the planned future tools without the links being broken.

### Empty state for the suite
On first load, show all the tools defined in the array, including coming-soon ones. The dashboard should look populated and interesting even when only Squish is live.

### Voice for dashboard copy
Hannah's brand voice: warm, direct, specific, casual without trying too hard. Short sentences for the thing that needs to land. Mix with longer flowing ones. No corporate jargon. Australian English (organise, colour, recognise, behaviour). No em dashes.

Use her existing voice as the reference. Examples from squish.html:
- "Drag images in, get small ones out."
- "Or click anywhere in this box. Takes JPEG, PNG, WebP, HEIC. Drop a whole folder if you want, no judgement."
- "Save this file anywhere. Bookmark it. Open it offline. It just works."

That's the tone.

---

## 6. Initial migration of Squish

The provided `squish.html` is a working tool. It needs to:
1. Move to `tools/squish.html` in the new repo.
2. Stay self-contained (don't refactor the CSS to use shared/tokens.css yet, leave the inline styles).
3. Optionally: extract its design tokens into `shared/tokens.css` and have Squish duplicate them inline (so it's still standalone). The dashboard can link to `shared/tokens.css`.

Don't refactor or change Squish. It's working and Hannah's happy with it.

---

## 7. Bring-Your-Own-Key (BYOK) for AI tools

Future tools (Voice, Postify, etc.) will need to call the Anthropic API. They use a shared BYOK pattern.

### How it works
- First time a user opens an AI tool, a settings panel asks for their Anthropic API key.
- Key is saved to `localStorage` under a known name (e.g. `geewizz_anthropic_key`).
- Future visits read from localStorage automatically.
- A small "settings" gear in the corner of the tool lets them update or clear the key.
- The tool calls the Anthropic API directly from the browser using that key.

### Helper module: `shared/ai-key.js`
Build this when the first AI tool is ready, not now. Should expose:
- `getKey()`: returns saved key or null
- `setKey(key)`: validates format, saves
- `clearKey()`: removes from storage
- `requireKey()`: returns a promise that resolves with key, prompts user via modal if missing

### Important: don't ever log or persist API keys to anywhere except the user's own browser storage. Make this very clear in any onboarding copy ("Your key never leaves your browser. Open the source on GitHub if you don't believe me.")

---

## 8. Vercel deployment

### Setup
1. Create new GitHub repo, public, called `geewizz-tools`.
2. Push the foundation (index.html + tools/squish.html + shared/ + README.md).
3. In Vercel: New Project → import the repo.
4. Framework preset: **Other** (or "Static"). Build command: blank. Output directory: `.` (root).
5. Deploy.
6. Vercel gives a URL like `geewizz-tools.vercel.app`. Test the dashboard and the Squish link both work.
7. Custom domain: when ready, add `tools.geewizz.com.au` in Vercel settings, follow their DNS instructions.

### vercel.json
Minimal config. Mostly there for clean URLs (so `/tools/squish.html` can be accessed as `/tools/squish` if we want). Default fine to start.

```json
{
  "cleanUrls": true,
  "trailingSlash": false
}
```

---

## 9. README.md content

Should explain:
- What Geewizz Tools is (a small suite of personal workflow tools, all open source, all privacy-first)
- How to use the live version (just visit the URL)
- How to fork and self-host (clone repo, deploy to Vercel/Cloudflare/Netlify, done, no env vars needed for local-only tools)
- How AI tools work (BYOK, key in browser localStorage, never sent to a server)
- How to suggest or contribute a new tool
- Credits: built by Hannah Gibson at Geewizz

Keep the tone in Hannah's voice (warm, direct, casual).

---

## 10. Build order

**Milestone 1: Foundation deployed.** Just this. Don't build any new tools yet.
- Repo set up
- Squish ported as `tools/squish.html`
- Dashboard with Squish live + 3-4 coming-soon tool cards (Frame, Swap, Voice)
- Deployed to Vercel
- README written
- Custom domain configured (if Hannah wants this now)

This is the deliverable for the first session. Don't build Frame yet. Don't build the AI key system yet. Get the foundation right first.

**Milestone 2 onward:** new tools get their own briefs.

---

## 11. Constraints and don't-dos

- **Don't add a build step.** No webpack, no Vite, no bundler. Plain HTML/CSS/JS.
- **Don't add a framework.** No React, no Vue, no Astro. Just vanilla.
- **Don't add tracking.** No Google Analytics, no Plausible, no anything. Privacy-first.
- **Don't add a backend yet.** Everything is static + browser code until a tool genuinely needs a function.
- **Don't lose Squish's existing aesthetic and behaviour** in the migration. Reuse it as-is.
- **Don't write hyperbolic dashboard copy.** Avoid: "passionate", "innovative", "dynamic", "leveraging", "thought leader", "I am excited to". Read like a real person wrote it.

---

## 12. What to ask Hannah before starting

If anything is unclear about the dashboard layout or the design tokens, ask. But don't ask permission for everything. Use judgement.

When done with Milestone 1, share:
- The deployed URL
- Confirmation Squish still works
- Screenshot of the dashboard
- Any decisions made along the way

---

## Appendix: Existing assets

`squish.html` is provided. It's the foundation for the design system. Read it carefully. Reuse its colour tokens, font setup, animation timings, SVG grain texture, and component patterns.

The file is already polished. Don't second-guess it.
