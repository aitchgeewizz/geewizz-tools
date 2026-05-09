# Geewizz Tools

A small set of single-purpose web tools that solve specific workflow snags. Built for one person to use daily, designed so anyone can fork them and use them too.

Live at [tools.geewizz.com.au](https://tools.geewizz.com.au) (when DNS is set up) or whichever Vercel URL it's deployed to.

## What's in here

- **Squish** — drag images in, get small ones out. Compress before emailing or uploading. Runs entirely in your browser.
- **Frame, Swap, Voice** — coming soon.

Each tool is a single self-contained HTML file. Open one in a browser, it works. Save it to your desktop and double-click, it still works.

## How to use it

Just visit the live URL and click a tool. There's no sign-up. There's no account. There's no tracking.

The image and file tools (like Squish) never upload anything. Your photos stay on your machine.

## How to run it yourself

Clone the repo and open `index.html` in any browser. That's it. No build step, no dependencies, no env vars.

```bash
git clone https://github.com/hannahgibson/geewizz-tools.git
cd geewizz-tools
open index.html
```

If you want to deploy your own copy, drop the repo into Vercel, Cloudflare Pages, or Netlify. Pick "static" or "other" as the framework, leave the build command blank, set the output directory to `.`, and you're done.

## How AI tools work

Tools that need an LLM use a Bring-Your-Own-Key pattern. You paste your Anthropic API key into the tool the first time you use it, and the key is saved to your own browser's localStorage. The tool calls the Anthropic API directly from your browser using that key.

The key never goes to a server I run. The repo is public so you can read the code and confirm that.

You can clear your key from the tool's settings panel any time.

## Design

Every tool shares the same visual language. Same fonts (Bricolage Grotesque + JetBrains Mono), same colour palette, same component patterns.

Design tokens live in `shared/tokens.css`. Tools duplicate them inline so each file stays standalone.

## Tech

- HTML, CSS, vanilla JS
- No framework, no build step
- Google Fonts for typography
- JSZip via CDN for archive downloads
- ffmpeg.wasm via CDN for any future video tools
- Anthropic SDK via CDN for AI tools
- Hosted on Vercel

## Suggesting a tool

Open an issue. Tell me what workflow snag you keep hitting and I'll see if it fits.

## Credits

Built by [Hannah Gibson](https://geewizz.com.au) at Geewizz.
