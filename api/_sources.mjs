// Works out what a link is and turns it into { meta, chunks }.
//   timed (has a transcript): YouTube, TikTok, Instagram, X, Facebook, Apple Podcasts, audio and video files
//   text (has paragraphs):    articles and blog posts (Readability, like a browser's reader view), PDFs
// Timed chunks carry t (seconds). Text chunks carry t: null, and h: true for headings.
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const API = 'https://api.supadata.ai/v1';
const CHUNK_CHARS = 900;            // roughly a paragraph per block in Notion
const MAX_TEXT_CHARS = 1_500_000;   // keeps a whole book under Vercel's 4.5 MB body limit
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const WORDS_PER_MIN = 230;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class SourceError extends Error {
  constructor(status, error, message) { super(message); this.status = status; this.error = error; }
}

export async function supadata(path) {
  const r = await fetch(`${API}${path}`, { headers: { 'x-api-key': process.env.SUPADATA_API_KEY } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

export const shapeTranscript = (t) => ({
  lang: t.lang,
  chunks: (Array.isArray(t.content) ? t.content : [{ text: String(t.content || ''), offset: 0 }])
    .map((c) => ({ t: Math.round((c.offset || 0) / 1000), text: (c.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((c) => c.text),
});

export const empty = (url) => ({
  url, kind: null, type: null, platform: null, id: null, title: null, author: null, authorUrl: null,
  publishedAt: null, durationSec: null, thumbnail: null, description: null, tags: [], links: [], embed: null,
});

// Keep only the fields that came back, so a later source fills the gaps
// an earlier one left instead of overwriting them with nulls.
export const merge = (base, ...parts) => parts.reduce((acc, p) => {
  for (const [k, v] of Object.entries(p || {})) {
    const blank = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (!blank && (acc[k] == null || acc[k] === '' || (Array.isArray(acc[k]) && !acc[k].length))) acc[k] = v;
  }
  return acc;
}, base);

// ── what kind of link is it ─────────────────────────
export function youtubeId(u) {
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (u.searchParams.get('v')) return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

const SOCIAL = /(^|\.)(tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com|fb\.watch)$/;
const AUDIO_EXT = /\.(mp3|m4a|wav|flac|ogg|mpga|mpeg|aac)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

export function classify(u) {
  const host = u.hostname.replace(/^www\./, '');
  if (youtubeId(u)) return 'youtube';
  if (SOCIAL.test(host)) return 'social';
  if (host === 'podcasts.apple.com') return 'apple';
  if (host === 'open.spotify.com' || host === 'spotify.link') return 'spotify';
  if (AUDIO_EXT.test(u.pathname)) return 'audio';
  if (VIDEO_EXT.test(u.pathname)) return 'video';
  if (/\.pdf$/i.test(u.pathname)) return 'pdf';
  return 'page'; // decided by what the server sends back
}

// ── timed sources ───────────────────────────────────
async function oembed(url) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!r.ok) return {};
    const o = await r.json();
    return { title: o.title || null, author: o.author_name || null, authorUrl: o.author_url || null, thumbnail: o.thumbnail_url || null };
  } catch { return {}; }
}

async function youtubeMeta(u) {
  const id = youtubeId(u);
  const url = `https://www.youtube.com/watch?v=${id}`;
  const v = await supadata(`/youtube/video?id=${encodeURIComponent(id)}`);
  if (v.status !== 200) console.warn('supadata /youtube/video', v.status, v.body?.error);
  const b = v.status === 200 ? v.body : {};
  const m = merge(empty(url), {
    platform: 'youtube', id, type: 'YouTube', embed: { type: 'video', url },
    title: b.title, author: b.channel?.name,
    authorUrl: b.channel?.id ? `https://www.youtube.com/channel/${b.channel.id}` : null,
    publishedAt: b.uploadDate, durationSec: Number.isFinite(b.duration) ? b.duration : null,
    thumbnail: b.thumbnail, description: b.description,
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 20) : [],
  });
  return m.title && m.author ? m : merge(m, await oembed(url));
}

async function socialMeta(u) {
  const r = await supadata(`/metadata?url=${encodeURIComponent(u.href)}`);
  if (r.status !== 200) console.warn('supadata /metadata', r.status, r.body?.error);
  const b = r.status === 200 ? r.body : {};
  return merge(empty(b.url || u.href), {
    type: 'Video', platform: b.platform, id: b.id, title: b.title,
    author: b.author?.displayName || b.author?.username, publishedAt: b.createdAt,
    durationSec: b.media?.duration ?? null, thumbnail: b.media?.thumbnailUrl, description: b.description,
  });
}

// Apple Podcasts: the episode id (?i=) leads to the audio file through Apple's
// free lookup API. The show notes come along with it.
async function appleMeta(u) {
  const show = u.pathname.match(/\/id(\d+)/)?.[1];
  const ep = u.searchParams.get('i');
  if (!show || !ep) throw new SourceError(400, 'whole-show', 'That is a whole show. Open one episode and copy its link.');
  const r = await fetch(`https://itunes.apple.com/lookup?id=${show}&entity=podcastEpisode&limit=300`);
  const j = await r.json().catch(() => ({}));
  const results = j.results || [];
  const pod = results.find((x) => x.wrapperType === 'track' && x.kind === 'podcast') || {};
  const e = results.find((x) => String(x.trackId) === ep);
  if (!e?.episodeUrl) {
    throw new SourceError(404, 'not-found', 'Apple did not share the audio for that episode. Try the episode’s YouTube link, or a direct link to its audio file.');
  }
  return merge(empty(u.href), {
    type: 'Podcast', platform: 'apple-podcasts', id: ep,
    title: e.trackName, author: e.collectionName || pod.collectionName,
    authorUrl: e.collectionViewUrl || pod.collectionViewUrl,
    publishedAt: e.releaseDate, durationSec: e.trackTimeMillis ? Math.round(e.trackTimeMillis / 1000) : null,
    thumbnail: e.artworkUrl600 || pod.artworkUrl600, description: e.description || e.shortDescription,
    embed: { type: 'audio', url: e.episodeUrl },
    audioUrl: e.episodeUrl,
  });
}

function fileMeta(u, kind) {
  const name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  return merge(empty(u.href), {
    type: kind === 'audio' ? 'Podcast' : 'Video', title: name, titleGuess: true, author: u.hostname.replace(/^www\./, ''),
    authorUrl: u.origin, embed: { type: kind, url: u.href }, audioUrl: u.href,
  });
}

// Returns { meta, transcript } or { meta, jobId } (the page polls long ones).
async function timed(meta) {
  meta.kind = 'timed';
  meta.type ||= 'Other';
  const src = meta.audioUrl || meta.url;
  const tr = await supadata(`/transcript?url=${encodeURIComponent(src)}&mode=auto&chunkSize=${CHUNK_CHARS}`);
  delete meta.audioUrl;
  if (tr.status === 202 && tr.body.jobId) return { meta, jobId: tr.body.jobId };
  if (tr.status !== 200 || tr.body.error) {
    throw new SourceError(tr.status >= 400 ? tr.status : 422, tr.body.error || 'upstream', tr.body.message || 'No transcript came back for that link.');
  }
  return { meta, transcript: shapeTranscript(tr.body) };
}

// ── text sources ────────────────────────────────────
// Long paragraphs are cut at sentence ends so each stays readable.
export function toChunks(paragraphs) {
  const out = [];
  let total = 0;
  for (const raw of paragraphs) {
    const h = /^#{1,6}\s/.test(raw);
    let s = raw.replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    while (s.length > CHUNK_CHARS) {
      const cut = s.slice(0, CHUNK_CHARS).search(/[.!?]["”’)]?\s[^.!?]*$/);
      const at = cut > CHUNK_CHARS / 3 ? cut + 1 : CHUNK_CHARS;
      out.push({ t: null, text: s.slice(0, at).trim() });
      s = s.slice(at).trim();
    }
    if (s) out.push({ t: null, text: s, ...(h && { h: true }) });
    total += raw.length;
    if (total > MAX_TEXT_CHARS) break;
  }
  return out;
}

const readMinutes = (chunks) => Math.max(1, Math.round(chunks.reduce((n, c) => n + c.text.split(/\s+/).length, 0) / WORDS_PER_MIN)) * 60;

// Markdown from the scraper, cleaned down to readable paragraphs.
export function markdownParagraphs(md) {
  return String(md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links keep their words
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.replace(/^\s*>\s?/, '').trim()).join(' ').trim())
    .filter((p) => p && !/^[-*_=\s|:]+$/.test(p))
    // Site menus come through as runs of "* Item * Item * Item"
    .filter((p) => (p.match(/(^|\s)\*\s/g) || []).length < 4);
}

// Reader view: the article body alone, without menus, footers or sign-up boxes.
// Returns null when the page has no article in its HTML (built by JavaScript).
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,pre';
export function readable(html, base) {
  let article;
  try {
    const { document } = parseHTML(html);
    article = new Readability(document).parse();
  } catch { return null; }
  if (!article || (article.textContent || '').trim().length < 600) return null;
  const { document } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const paragraphs = [];
  for (const el of document.querySelectorAll(BLOCKS)) {
    if (el.querySelector(BLOCKS)) continue; // only the innermost blocks, so nothing repeats
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const tag = el.tagName.toLowerCase();
    paragraphs.push(/^h\d$/.test(tag) ? `## ${t}` : tag === 'li' ? `• ${t}` : t);
  }
  const links = [...new Set([...document.querySelectorAll('a[href]')].map((a) => {
    try { return new URL(a.getAttribute('href'), base).href; } catch { return null; }
  }).filter((u) => u && /^https?:/.test(u)))];
  return { paragraphs, links, title: article.title, byline: article.byline, site: article.siteName, publishedAt: article.publishedTime, excerpt: article.excerpt };
}

// Title, author, date and image from the page head. Regex is enough for meta tags.
export function headMeta(html, base) {
  const head = html.slice(0, 300_000);
  const tag = (re) => head.match(re)?.[1]?.trim() || null;
  const meta = (...names) => {
    for (const n of names) {
      const v = tag(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']`, 'i'))
        || tag(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`, 'i'));
      if (v) return decode(v);
    }
    return null;
  };
  const ld = tag(/"datePublished"\s*:\s*"([^"]+)"/i);
  const ldAuthor = tag(/"author"\s*:\s*(?:\[\s*)?\{[^}]*?"name"\s*:\s*"([^"]+)"/i);
  const author = meta('author', 'article:author', 'parsely-author');
  const abs = (s) => { try { return s ? new URL(s, base).href : null; } catch { return null; } };
  return {
    title: meta('og:title', 'twitter:title') || decode(tag(/<title[^>]*>([^<]+)<\/title>/i) || ''),
    site: meta('og:site_name', 'application-name'),
    author: (author && !/^https?:/.test(author) ? author : null) || (ldAuthor && decode(ldAuthor)),
    publishedAt: meta('article:published_time', 'date', 'publish-date', 'dc.date') || ld,
    thumbnail: abs(meta('og:image', 'twitter:image')),
    description: meta('og:description', 'description', 'twitter:description'),
  };
}
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));

async function pdfFrom(u, bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const [{ text }, info] = await Promise.all([
    extractText(pdf, { mergePages: false }),
    getMeta(pdf).catch(() => ({})),
  ]);
  // pdf.js gives lines; blank lines (or a page break) end a paragraph.
  const paragraphs = text.flatMap((page) => String(page).split(/\n\s*\n|(?<=[.!?:])\n(?=[A-Z“"•\d])/));
  const chunks = toChunks(paragraphs);
  if (!chunks.length) throw new SourceError(422, 'no-text', 'That PDF has no text to read. It might be scanned images.');
  const i = info.info || {};
  const fileName = decodeURIComponent(u.pathname.split('/').pop() || '').replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ');
  const created = String(i.CreationDate || '').match(/^D:(\d{4})(\d{2})(\d{2})/);
  const meta = merge(empty(u.href), {
    kind: 'text', type: 'PDF', platform: 'pdf', embed: { type: 'pdf', url: u.href },
    title: (i.Title && String(i.Title).trim()) || fileName || u.hostname,
    titleGuess: !(i.Title && String(i.Title).trim()),
    author: (i.Author && String(i.Author).trim()) || u.hostname.replace(/^www\./, ''),
    authorUrl: u.origin, publishedAt: created ? `${created[1]}-${created[2]}-${created[3]}` : null,
    durationSec: readMinutes(chunks),
  });
  return { meta, transcript: { chunks } };
}

async function articleFrom(u, html) {
  const h = html ? headMeta(html, u.href) : {};
  const r = html ? readable(html, u.href) : null;
  if (r) {
    const chunks = toChunks(r.paragraphs);
    const title = h.title || r.title;
    if (chunks[0]?.h && title && chunks[0].text.toLowerCase() === title.toLowerCase()) chunks.shift();
    const site = h.site || r.site || u.hostname.replace(/^www\./, '');
    const by = r.byline || h.author;
    return {
      meta: merge(empty(u.href), {
        kind: 'text', type: 'Article', platform: 'web',
        title, author: by ? `${by} · ${site}` : site, authorUrl: u.origin,
        publishedAt: h.publishedAt || r.publishedAt, thumbnail: h.thumbnail,
        description: h.description || r.excerpt, links: r.links.slice(0, 300),
        embed: { type: 'bookmark', url: u.href }, durationSec: readMinutes(chunks),
      }),
      transcript: { chunks },
    };
  }
  // No article in the HTML (the page is built by JavaScript), so ask Supadata to render it.
  const s = await supadata(`/web/scrape?url=${encodeURIComponent(u.href)}&noLinks=true`);
  if (s.status !== 200) {
    console.warn('supadata /web/scrape', s.status, s.body?.error);
    throw new SourceError(s.status >= 400 ? s.status : 422, s.body?.error || 'upstream', s.body?.message || 'Could not read that page.');
  }
  const chunks = toChunks(markdownParagraphs(s.body.content));
  if (!chunks.length) throw new SourceError(422, 'no-text', 'That page had no article text to read.');
  // Drop a leading heading that just repeats the title.
  const title = h.title || s.body.name;
  if (chunks[0]?.h && title && chunks[0].text.toLowerCase() === title.toLowerCase()) chunks.shift();
  const site = h.site || u.hostname.replace(/^www\./, '');
  const meta = merge(empty(s.body.ogUrl || u.href), {
    kind: 'text', type: 'Article', platform: 'web',
    title, author: h.author ? `${h.author} · ${site}` : site, authorUrl: u.origin,
    publishedAt: h.publishedAt, thumbnail: h.thumbnail,
    description: h.description || s.body.description,
    links: (s.body.urls || []).filter((x) => /^https?:/.test(x)).slice(0, 300),
    embed: { type: 'bookmark', url: u.href },
    durationSec: readMinutes(chunks),
  });
  return { meta, transcript: { chunks } };
}

// A plain link could be a page, a PDF or a media file. Ask the server.
async function pageOrFile(u) {
  let r;
  try {
    r = await fetch(u.href, { headers: { 'user-agent': UA, accept: 'text/html,application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch { r = null; }
  const ct = r?.headers.get('content-type') || '';
  const finalUrl = new URL(r?.url || u.href);
  if (/application\/pdf/i.test(ct)) {
    if (Number(r.headers.get('content-length')) > MAX_PDF_BYTES) throw new SourceError(413, 'too-big', 'That PDF is over 40 MB.');
    return pdfFrom(finalUrl, await r.arrayBuffer());
  }
  if (/^audio\//i.test(ct) || /^video\//i.test(ct)) {
    r.body?.cancel();
    return timed(fileMeta(finalUrl, /^audio/i.test(ct) ? 'audio' : 'video'));
  }
  const html = r?.ok && /html/i.test(ct) ? await r.text() : '';
  return articleFrom(finalUrl, html);
}

export async function fromLink(u) {
  switch (classify(u)) {
    case 'youtube': return timed(await youtubeMeta(u));
    case 'social': return timed(await socialMeta(u));
    case 'apple': return timed(await appleMeta(u));
    case 'spotify': throw new SourceError(400, 'spotify', 'Spotify does not share episode audio. Find the same episode on Apple Podcasts or YouTube and paste that link.');
    case 'audio':
    case 'video': return timed(fileMeta(u, classify(u)));
    case 'pdf': {
      const r = await fetch(u.href, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new SourceError(r.status, 'fetch', `That PDF did not open (the site said ${r.status}).`);
      if (Number(r.headers.get('content-length')) > MAX_PDF_BYTES) throw new SourceError(413, 'too-big', 'That PDF is over 40 MB.');
      return pdfFrom(new URL(r.url || u.href), await r.arrayBuffer());
    }
    default: return pageOrFile(u);
  }
}
