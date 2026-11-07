// POST /api/transcript  { url }        -> { meta, transcript } or { meta, jobId }
// GET  /api/transcript?job=<jobId>     -> { status, transcript? }
// Transcripts come from Supadata (docs.supadata.ai). Long videos come back as a
// job that the page polls.
import { checkPasscode, requireEnv, readBody } from './_lib.mjs';

const API = 'https://api.supadata.ai/v1';
const CHUNK_CHARS = 900; // roughly a paragraph per block in Notion

async function supadata(path) {
  const r = await fetch(`${API}${path}`, { headers: { 'x-api-key': process.env.SUPADATA_API_KEY } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

const shapeTranscript = (t) => ({
  lang: t.lang,
  chunks: (Array.isArray(t.content) ? t.content : [{ text: String(t.content || ''), offset: 0 }])
    .map((c) => ({ t: Math.round((c.offset || 0) / 1000), text: (c.text || '').replace(/\s+/g, ' ').trim() }))
    .filter((c) => c.text),
});

// The video id comes from the link itself, so a failed details lookup never
// loses the embed, the timestamp links or the YouTube type.
export function youtubeId(u) {
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (u.searchParams.get('v')) return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

const empty = (url) => ({
  url, platform: null, id: null, title: null, author: null, authorUrl: null,
  publishedAt: null, durationSec: null, thumbnail: null, description: null, tags: [],
});

// Supadata's YouTube video endpoint: title, channel, upload date, description.
const fromSupadataVideo = (v) => ({
  title: v.title || null,
  author: v.channel?.name || null,
  authorUrl: v.channel?.id ? `https://www.youtube.com/channel/${v.channel.id}` : null,
  publishedAt: v.uploadDate || null,
  durationSec: Number.isFinite(v.duration) ? v.duration : null,
  thumbnail: v.thumbnail || null,
  description: v.description || null,
  tags: Array.isArray(v.tags) ? v.tags.slice(0, 20) : [],
});

// Supadata's general metadata endpoint, for non-YouTube links.
const fromSupadataMeta = (m) => ({
  platform: m.platform || null,
  id: m.id || null,
  title: m.title || null,
  author: m.author?.displayName || m.author?.username || null,
  publishedAt: m.createdAt || null,
  durationSec: m.media?.duration ?? null,
  thumbnail: m.media?.thumbnailUrl || null,
  description: m.description || null,
});

// YouTube's own oEmbed: free, no key, title + channel only. The safety net.
async function oembed(url) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!r.ok) return {};
    const o = await r.json();
    return { title: o.title || null, author: o.author_name || null, authorUrl: o.author_url || null, thumbnail: o.thumbnail_url || null };
  } catch { return {}; }
}

// Keep only the fields that came back, so a later source fills the gaps
// an earlier one left instead of overwriting them with nulls.
const merge = (base, ...parts) => parts.reduce((acc, p) => {
  for (const [k, v] of Object.entries(p || {})) {
    const blank = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (!blank && (acc[k] == null || acc[k] === '' || (Array.isArray(acc[k]) && !acc[k].length))) acc[k] = v;
  }
  return acc;
}, base);

async function details(parsed) {
  const id = youtubeId(parsed);
  if (id) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    const v = await supadata(`/youtube/video?id=${encodeURIComponent(id)}`);
    if (v.status !== 200) console.warn('supadata /youtube/video', v.status, v.body?.error);
    const m = merge(empty(url), { platform: 'youtube', id }, v.status === 200 ? fromSupadataVideo(v.body) : {});
    return m.title && m.author ? m : merge(m, await oembed(url));
  }
  const r = await supadata(`/metadata?url=${encodeURIComponent(parsed.href)}`);
  if (r.status !== 200) console.warn('supadata /metadata', r.status, r.body?.error);
  return merge(empty(parsed.href), r.status === 200 ? fromSupadataMeta(r.body) : {});
}

// Supadata errors arrive as { error, message }. "transcript-unavailable" is a 206.
const failed = (res, r, fallback) =>
  res.status(r.status >= 400 ? r.status : 422).json({
    error: r.body.error || 'upstream',
    message: r.body.message || fallback,
  });

export default async function handler(req, res) {
  if (!checkPasscode(req, res) || !requireEnv(res, 'SUPADATA_API_KEY')) return;

  if (req.method === 'GET') {
    const job = String(req.query?.job || '');
    if (!/^[\w-]+$/.test(job)) return res.status(400).json({ error: 'invalid-request', message: 'Missing job id.' });
    const r = await supadata(`/transcript/${job}`);
    if (r.status !== 200) return failed(res, r, 'Could not check the transcript job.');
    if (r.body.status === 'completed') return res.json({ status: 'completed', transcript: shapeTranscript(r.body) });
    if (r.body.status === 'failed') {
      return res.status(422).json({ error: r.body.error?.error || 'failed', message: r.body.error?.message || 'Transcription failed.' });
    }
    return res.json({ status: r.body.status || 'active' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });

  const { url } = readBody(req);
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { /* handled below */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    return res.status(400).json({ error: 'invalid-request', message: 'That does not look like a link.' });
  }
  // Ask Supadata one thing at a time. The free plan rate-limits, and firing the
  // details and transcript calls together most likely cost us the title once.
  const m = await details(parsed);
  const tr = await supadata(`/transcript?url=${encodeURIComponent(m.url)}&mode=auto&chunkSize=${CHUNK_CHARS}`);

  if (tr.status === 202 && tr.body.jobId) return res.status(202).json({ meta: m, jobId: tr.body.jobId });
  if (tr.status !== 200 || tr.body.error) return failed(res, tr, 'No transcript came back for that link.');
  return res.json({ meta: m, transcript: shapeTranscript(tr.body) });
}
