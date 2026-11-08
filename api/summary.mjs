// POST /api/summary  { title, author, description, durationSec, chunks[{t,text}] }
//   -> { summary: { brief, keyPoints[{t,point}], quotes[{t,quote,speaker}], mentions[{name,kind,url,t}], tags[] } }
// One Claude call per episode. The transcript goes in with [m:ss] stamps so every
// point and quote can link back to its moment.
import Anthropic from '@anthropic-ai/sdk';
import { checkPasscode, requireEnv, readBody } from './_lib.mjs';
import { stamp } from './notion.mjs';

const MODEL = 'claude-opus-5-5';
const KINDS = ['person', 'company', 'product or tool', 'book', 'article or post', 'podcast or show', 'other'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['brief', 'keyPoints', 'quotes', 'mentions', 'tags'],
  properties: {
    brief: { type: 'string', description: 'Two to four sentences: what this episode is about and why it matters.' },
    keyPoints: {
      type: 'array',
      description: 'The main ideas, in the order they come up. Usually 5 to 12.',
      items: {
        type: 'object', additionalProperties: false, required: ['t', 'point'],
        properties: {
          t: { type: 'integer', description: 'Seconds from the start, taken from the nearest [m:ss] stamp.' },
          point: { type: 'string', description: 'One or two sentences.' },
        },
      },
    },
    quotes: {
      type: 'array',
      description: 'Up to 6 lines worth quoting, word for word from the transcript.',
      items: {
        type: 'object', additionalProperties: false, required: ['t', 'quote', 'speaker'],
        properties: {
          t: { type: 'integer' },
          quote: { type: 'string' },
          speaker: { type: 'string', description: 'Name if the transcript makes it clear, otherwise an empty string.' },
        },
      },
    },
    mentions: {
      type: 'array',
      description: 'People, companies, tools, books, articles and shows that are named and discussed.',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'kind', 'url', 't'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          url: { type: 'string', description: 'Only a URL that appears in the show notes. Empty string otherwise. Never guess one.' },
          t: { type: 'integer', description: 'Seconds where it is first mentioned.' },
        },
      },
    },
    tags: {
      type: 'array',
      description: '3 to 6 short lowercase topic tags for a research library.',
      items: { type: 'string' },
    },
  },
};

const SYSTEM = `You summarise podcast and video transcripts for a brand designer's research library.
Write plainly, in Australian English, without hype. Keep to what is actually said; do not add outside facts.
Transcripts are auto-generated, so names may be misspelt: prefer the spelling in the title or show notes.
Every timestamp you return must come from a [m:ss] stamp in the transcript, converted to seconds.`;

function prompt(b) {
  const lines = b.chunks.map((c) => `[${stamp(c.t)}] ${c.text}`).join('\n');
  return [
    `Title: ${b.title || 'Unknown'}`,
    `Channel or show: ${b.author || 'Unknown'}`,
    b.description ? `Show notes:\n${b.description}` : 'Show notes: none',
    `Transcript:\n${lines}`,
  ].join('\n\n');
}

// Keep the summary honest even if the model drifts: timestamps snap to real
// stamps, and a URL survives only if it is in the show notes.
function tidy(s, b) {
  const stamps = b.chunks.map((c) => c.t);
  const snap = (t) => {
    if (!Number.isFinite(t) || !stamps.length) return 0;
    return stamps.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), stamps[0]);
  };
  const notes = String(b.description || '');
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    brief: str(s.brief),
    keyPoints: (s.keyPoints || []).map((k) => ({ t: snap(k.t), point: str(k.point) })).filter((k) => k.point),
    quotes: (s.quotes || []).map((q) => ({ t: snap(q.t), quote: str(q.quote), speaker: str(q.speaker) })).filter((q) => q.quote),
    mentions: (s.mentions || [])
      .map((m) => ({ t: snap(m.t), name: str(m.name), kind: KINDS.includes(m.kind) ? m.kind : 'other', url: str(m.url) && notes.includes(str(m.url)) ? str(m.url) : '' }))
      .filter((m) => m.name),
    tags: [...new Set((s.tags || []).map((t) => str(t).toLowerCase()).filter(Boolean))].slice(0, 8),
  };
}

// Never let a key end up in the logs.
const redact = (s) => String(s ?? '').replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[hidden]').slice(0, 500);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });
  if (!checkPasscode(req, res) || !requireEnv(res, 'ANTHROPIC_API_KEY')) return;

  const b = readBody(req);
  if (!Array.isArray(b.chunks) || !b.chunks.length) {
    return res.status(400).json({ error: 'invalid-request', message: 'Nothing to summarise yet.' });
  }

  // Catch a pasted snippet (or stray spaces) before it reaches a request header.
  const apiKey = process.env.ANTHROPIC_API_KEY.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]+$/.test(apiKey)) {
    return res.status(500).json({ error: 'not-configured', message: 'ANTHROPIC_API_KEY in Vercel should be just the key, starting sk-ant-, with nothing else.' });
  }

  const client = new Anthropic({ apiKey });
  try {
    // Streaming keeps a long episode from hitting an HTTP timeout. The server-side
    // fallback re-runs the request on another model if a safety classifier declines.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt(b) }],
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'refusal', message: 'Claude declined to summarise this one.' });
    }
    if (msg.stop_reason === 'max_tokens') {
      return res.status(422).json({ error: 'too-long', message: 'The summary ran out of room. Try again.' });
    }
    const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    const summary = tidy(JSON.parse(text), b);
    console.log('summary usage', msg.usage?.input_tokens, msg.usage?.output_tokens);
    return res.json({ summary });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'not-configured', message: 'The Anthropic API key is wrong or missing.' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'busy', message: 'Claude is busy. Try again in a minute.' });
    }
    if (e instanceof Anthropic.APIError) {
      console.error('anthropic', e.status, redact(e.message));
      return res.status(502).json({ error: 'anthropic', message: `Claude said ${e.status}. Try again.` });
    }
    console.error('summary', e?.name, redact(e?.message));
    return res.status(500).json({ error: 'summary', message: 'The summary did not come back in one piece. Try again.' });
  }
}
