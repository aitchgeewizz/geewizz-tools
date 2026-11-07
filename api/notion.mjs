// POST /api/notion  { title, url, author, authorUrl, description, thumbnail, publishedAt, durationSec, type, tags[], notes, platform, id, chunks[] }
// Creates a page in the Research library database, with the transcript as the page body.
// Each paragraph starts with a timestamp that links back to that moment in the video.
import { checkPasscode, requireEnv, readBody } from './_lib.mjs';

const NOTION = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const MAX_TEXT = 1900;   // Notion caps a text object at 2000 characters
const BATCH = 100;       // and a request at 100 blocks
const TYPES = ['YouTube', 'Podcast', 'Article', 'Other'];
const CHANNEL = 'Podcast or Channel';

async function notion(path, method, body) {
  const r = await fetch(`${NOTION}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.message || `Notion said ${r.status}`), { status: r.status, code: json.code });
  return json;
}

export const stamp = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const text = (content, extra = {}) => ({ type: 'text', text: { content, ...extra.text }, ...(extra.annotations && { annotations: extra.annotations }) });

const splitLong = (s) => {
  const out = [];
  for (let i = 0; i < s.length; i += MAX_TEXT) out.push(s.slice(i, i + MAX_TEXT));
  return out;
};

export function transcriptBlocks({ chunks, platform, id }) {
  const jump = (t) => (platform === 'youtube' && id ? `https://www.youtube.com/watch?v=${id}&t=${t}s` : null);
  return (chunks || []).flatMap((c) =>
    splitLong(String(c.text || '')).map((part, i) => {
      const rich = [];
      if (i === 0 && Number.isFinite(c.t)) {
        const link = jump(c.t);
        rich.push(text(stamp(c.t), { text: link ? { link: { url: link } } : {}, annotations: { code: true } }));
        rich.push(text(' '));
      }
      rich.push(text(part));
      return { object: 'block', type: 'paragraph', paragraph: { rich_text: rich } };
    })
  );
}

// Show notes: the video description, one paragraph per line, with links and
// chapter timestamps ("12:34 Topic") made clickable.
const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
const CHAPTER_RE = /^(\d{1,2}:)?\d{1,2}:\d{2}\b/;
const toSeconds = (s) => s.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);

export function linkify(line) {
  const rich = [];
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    if (m.index > last) rich.push(...splitLong(line.slice(last, m.index)).map((t) => text(t)));
    rich.push(text(m[0].slice(0, MAX_TEXT), { text: { link: { url: m[0] } } }));
    last = m.index + m[0].length;
  }
  if (last < line.length) rich.push(...splitLong(line.slice(last)).map((t) => text(t)));
  return rich;
}

export function showNoteBlocks({ description, platform, id }) {
  if (!description) return [];
  const lines = String(description).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const ch = line.match(CHAPTER_RE);
    let rich;
    if (ch && platform === 'youtube' && id) {
      const t = toSeconds(ch[0]);
      rich = [text(ch[0], { text: { link: { url: `https://www.youtube.com/watch?v=${id}&t=${t}s` } }, annotations: { code: true } }), ...linkify(line.slice(ch[0].length))];
    } else {
      rich = linkify(line);
    }
    // Notion allows 100 rich text items per block
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: rich.slice(0, 100) } };
  });
}

export function pageProperties(b, today) {
  const props = {
    Title: { title: [text(String(b.title || b.url || 'Untitled').slice(0, MAX_TEXT))] },
    'Source URL': { url: b.url || null },
    Added: { date: { start: today } },
    Type: { select: { name: TYPES.includes(b.type) ? b.type : 'Other' } },
    Status: { select: { name: 'Inbox' } },
  };
  if (b.author) props[CHANNEL] = { rich_text: [text(String(b.author).slice(0, MAX_TEXT), b.authorUrl ? { text: { link: { url: b.authorUrl } } } : {})] };
  if (b.publishedAt) props.Published = { date: { start: String(b.publishedAt).slice(0, 10) } };
  if (Number.isFinite(b.durationSec)) props.Minutes = { number: Math.round(b.durationSec / 60) };
  if (b.notes) props.Notes = { rich_text: [text(String(b.notes).slice(0, MAX_TEXT))] };
  const tags = (b.tags || []).map((t) => String(t).trim().replace(/,/g, '')).filter(Boolean).slice(0, 20);
  if (tags.length) props.Tags = { multi_select: tags.map((name) => ({ name: name.slice(0, 100) })) };
  return props;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });
  if (!checkPasscode(req, res) || !requireEnv(res, 'NOTION_TOKEN', 'NOTION_DATABASE_ID')) return;

  const b = readBody(req);
  if (!b.url || !Array.isArray(b.chunks) || !b.chunks.length) {
    return res.status(400).json({ error: 'invalid-request', message: 'Nothing to send yet.' });
  }

  // "Added" is the day in Melbourne, not UTC.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());

  const head = [];
  if (b.platform === 'youtube' && b.url) head.push({ object: 'block', type: 'video', video: { type: 'external', external: { url: b.url } } });
  const notes = showNoteBlocks(b);
  if (notes.length) head.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [text('Show notes')] } }, ...notes);
  head.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [text('Transcript')] } });
  const blocks = [...head, ...transcriptBlocks(b)];

  try {
    const page = await notion('/pages', 'POST', {
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: pageProperties(b, today),
      ...(b.thumbnail && { cover: { type: 'external', external: { url: b.thumbnail } } }),
      children: blocks.slice(0, BATCH),
    });
    for (let i = BATCH; i < blocks.length; i += BATCH) {
      await notion(`/blocks/${page.id}/children`, 'PATCH', { children: blocks.slice(i, i + BATCH) });
    }
    return res.json({ ok: true, url: page.url });
  } catch (e) {
    const hint = e.code === 'object_not_found'
      ? 'Notion cannot see the Research library. Share it with your integration (••• menu → Connections).'
      : e.message;
    return res.status(e.status || 500).json({ error: e.code || 'notion', message: hint });
  }
}
