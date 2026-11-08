// POST /api/transcript  { url }        -> { meta, transcript } or { meta, jobId }
// GET  /api/transcript?job=<jobId>     -> { status, transcript? }
// Any link: videos and podcasts become a timed transcript (Supadata), articles
// and PDFs become paragraphs. See _sources.mjs. Long media come back as a job
// that the page polls.
import { checkPasscode, requireEnv, readBody } from './_lib.mjs';
import { fromLink, supadata, shapeTranscript, SourceError } from './_sources.mjs';

export { youtubeId } from './_sources.mjs';

export default async function handler(req, res) {
  if (!checkPasscode(req, res) || !requireEnv(res, 'SUPADATA_API_KEY')) return;

  if (req.method === 'GET') {
    const job = String(req.query?.job || '');
    if (!/^[\w-]+$/.test(job)) return res.status(400).json({ error: 'invalid-request', message: 'Missing job id.' });
    const r = await supadata(`/transcript/${job}`);
    if (r.status !== 200) {
      return res.status(r.status >= 400 ? r.status : 422).json({ error: r.body.error || 'upstream', message: r.body.message || 'Could not check the transcript job.' });
    }
    if (r.body.status === 'completed') return res.json({ status: 'completed', transcript: shapeTranscript(r.body) });
    if (r.body.status === 'failed') {
      return res.status(422).json({ error: r.body.error?.error || 'failed', message: r.body.error?.message || 'Transcription failed.' });
    }
    return res.json({ status: r.body.status || 'active' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });

  const { url } = readBody(req);
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch { /* handled below */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    return res.status(400).json({ error: 'invalid-request', message: 'That does not look like a link.' });
  }

  try {
    const out = await fromLink(parsed);
    return res.status(out.jobId ? 202 : 200).json(out);
  } catch (e) {
    if (e instanceof SourceError) return res.status(e.status).json({ error: e.error, message: e.message });
    console.error('transcript', e?.name, String(e?.message).slice(0, 300));
    return res.status(500).json({ error: 'internal', message: 'Something went wrong reading that link.' });
  }
}
