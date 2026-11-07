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

function shapeMeta(m, url) {
  return {
    url,
    platform: m.platform || null,
    id: m.id || null,
    title: m.title || null,
    author: m.author?.displayName || m.author?.username || null,
    publishedAt: m.createdAt || null,
    durationSec: m.media?.duration ?? null,
    thumbnail: m.media?.thumbnailUrl || null,
  };
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
  const q = encodeURIComponent(parsed.href);

  const [meta, tr] = await Promise.all([
    supadata(`/metadata?url=${q}`),
    supadata(`/transcript?url=${q}&mode=auto&chunkSize=${CHUNK_CHARS}`),
  ]);

  // Metadata is nice to have; a transcript without it still works.
  const m = meta.status === 200 ? shapeMeta(meta.body, parsed.href) : shapeMeta({}, parsed.href);

  if (tr.status === 202 && tr.body.jobId) return res.status(202).json({ meta: m, jobId: tr.body.jobId });
  if (tr.status !== 200 || tr.body.error) return failed(res, tr, 'No transcript came back for that link.');
  return res.json({ meta: m, transcript: shapeTranscript(tr.body) });
}
