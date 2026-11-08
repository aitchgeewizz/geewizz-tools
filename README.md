# Geewizz Tools

A small set of single-purpose web tools that solve specific workflow snags. Built for one person to use daily, designed so anyone can fork them and use them too.

Live at [tools.geewizz.com.au](https://tools.geewizz.com.au) (when DNS is set up) or whichever Vercel URL it's deployed to.

## What's in here

- **Squish** — drag images in, get small ones out. Compress before emailing or uploading. Runs entirely in your browser.
- **Reel** — drop images, MP4s or GIFs. Sequence them, time them, add transitions or Ken Burns, download a looping GIF or an MP4. Built for quick showcase reels. Six transition styles, ping-pong, hold ends, separate timing for stills and clips.
- **Transcript** — paste any link (YouTube, TikTok, Instagram, X, Facebook, Apple Podcasts, an audio or video file, an article or a PDF) and get the text plus a Claude summary. Copy it, or send it to a Notion database with the title, channel or site, publish date, tags and notes filled in.

Each tool is a single self-contained HTML file. Open one in a browser, it works. Save it to your desktop and double-click, it still works.

## How to use it

Just visit the live URL and click a tool. There's no sign-up. There's no account. There's no tracking.

The image and file tools (like Squish) never upload anything. Your photos stay on your machine.

## How to run it yourself

Clone the repo and open `index.html` in any browser. That's it. No build step, no dependencies, no env vars.

```bash
git clone https://github.com/aitchgeewizz/geewizz-tools.git
cd geewizz-tools
open index.html
```

If you want to deploy your own copy, drop the repo into Vercel, Cloudflare Pages, or Netlify. Pick "static" or "other" as the framework, leave the build command blank, set the output directory to `.`, and you're done.

## How AI tools work

Tools that need an LLM use a Bring-Your-Own-Key pattern. You paste your Anthropic API key into the tool the first time you use it, and the key is saved to your own browser's localStorage. The tool calls the Anthropic API directly from your browser using that key.

The key never goes to a server I run. The repo is public so you can read the code and confirm that.

You can clear your key from the tool's settings panel any time.

## Transcript: the one tool with a server

Transcript can't run purely in the browser: YouTube and Notion both block direct browser requests. So it uses three small Vercel functions in `api/`:

- `api/transcript.mjs` works out what the link is (`api/_sources.mjs`). Videos, podcasts and media files get a transcript from [Supadata](https://supadata.ai); long ones come back as a job the page polls. Apple Podcasts episodes are found through Apple's free lookup API. Articles are read with Supadata's web scrape, PDFs with [unpdf](https://github.com/unjs/unpdf). Spotify doesn't share audio, so it isn't supported.
- `api/summary.mjs` sends the text to Claude (Opus 5.5) for an in-brief summary, key points, quotes, mentions and tags, each linked to its timestamp (or paragraph, for articles and PDFs). Links only come from the show notes or the page itself, never guessed. Tags come from the ones already in Notion where they fit.
- `api/notion.mjs` lists the Tags already in Notion (GET), and creates a page (POST): the video, audio, PDF or a bookmark, then the summary, show notes, and the transcript or full text.

Both are locked behind a passcode, so a public deploy can't spend your credits or write to your Notion. Set these in Vercel → Settings → Environment Variables:

| Name | What |
|---|---|
| `SUPADATA_API_KEY` | From your Supadata dashboard |
| `NOTION_TOKEN` | An internal integration secret from notion.so/profile/integrations |
| `NOTION_DATABASE_ID` | The database the pages go into. Share it with the integration (••• → Connections) |
| `TOOLS_PASSCODE` | Anything you like. The tool asks for it once per browser |
| `ANTHROPIC_API_KEY` | From platform.claude.com → API keys. Without it the tool still works, just without summaries |

The Notion database needs these properties: Title (title), Source URL (url), Podcast or Channel (text), Summary (text), Published (date), Added (date), Type (select: YouTube, Podcast, Video, Article, PDF, Other), Tags (multi-select), Status (select: Inbox, Reviewed), Minutes (number), Notes (text).

There's a bookmarklet at the bottom of the tool. Drag it to your bookmarks bar, click it on any video, article or PDF, and the tool opens with that link already fetching.

## Design

Every tool shares the same visual language. It matches the geewizz portfolio: Geist and Geist Mono, a warm grey ground (#EDEBE8), ink for actions and one teal accent (#24DAE0). Mono is for metadata labels only.

Design tokens live in `shared/tokens.css`. Tools duplicate them inline so each file stays standalone.

## Tech

- HTML, CSS, vanilla JS. No framework, no build step.
- Google Fonts for typography
- JSZip via CDN for archive downloads (Squish)
- gifenc + gifuct-js via CDN for GIF encode and decode (Reel)
- mp4-muxer + native WebCodecs for MP4 encode (Reel)
- SortableJS via CDN for tile reordering (Reel)
- Hosted on Vercel

### CDN gotcha

If you fork and add a new tool that imports JS from a CDN, prefer `https://cdn.jsdelivr.net/npm/<pkg>/+esm` over `https://esm.sh/<pkg>`. The esm.sh build for some packages only re-exports the default, which silently breaks named imports and produces a module that fails to link. jsdelivr's `+esm` preserves named exports.

## Suggesting a tool

Open an issue. Tell me what workflow snag you keep hitting and I'll see if it fits.

## Credits

Built by [Hannah Gibson](https://geewizz.com.au) at Geewizz.
