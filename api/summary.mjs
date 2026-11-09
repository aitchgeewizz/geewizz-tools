// POST /api/summary  { kind, type, title, author, description, links[], existingTags[], chunks[{t,text}] }
//   -> { summary: { brief, keyPoints[{t,point}], quotes[{t,quote,speaker}], mentions[{name,kind,url,t}], tags[], newTags[] } }
// One Claude call per item. A transcript goes in with [m:ss] stamps and an article
// or PDF with [¶n] paragraph numbers, so every point and quote can link back.
import Anthropic from '@anthropic-ai/sdk';
import { checkPasscode, requireEnv, readBody } from './_lib.mjs';
import { stamp } from './notion.mjs';

const MODEL = 'claude-opus-5-5';
const KINDS = ['person', 'company', 'product or tool', 'book', 'article or post', 'podcast or show', 'other'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'brief', 'keyPoints', 'quotes', 'mentions', 'tags'],
  properties: {
    title: { type: 'string', description: 'The real title of the piece as the source gives it (for a paper, its title; for a talk, its name). Keep the given title if it already is one.' },
    brief: { type: 'string', description: 'Two to four sentences: what this episode is about and why it matters.' },
    keyPoints: {
      type: 'array',
      description: 'The main ideas, in the order they come up. Usually 5 to 12.',
      items: {
        type: 'object', additionalProperties: false, required: ['t', 'point'],
        properties: {
          t: { type: 'integer', description: 'Where it comes from: seconds for a [m:ss] stamp, or n for a [¶n] paragraph.' },
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
          url: { type: 'string', description: 'Only a URL listed in the show notes or the links. Empty string otherwise. Never guess one.' },
          t: { type: 'integer', description: 'Where it is first mentioned, in the same units.' },
        },
      },
    },
    tags: {
      type: 'array',
      description: '2 to 5 short lowercase topic tags. Reuse the library tags wherever one fits; add a new tag only for a topic none of them covers.',
      items: { type: 'string' },
    },
  },
};

const SYSTEM = `You summarise videos, podcasts, articles and PDFs for a brand designer's research library.
Write plainly, in Australian English, without hype. Keep to what is actually said; do not add outside facts.
Transcripts are auto-generated, so names may be misspelt: prefer the spelling in the title or show notes.
Every location you return must come from the source: a [m:ss] stamp converted to seconds, or the n of a [¶n] paragraph.`;

const MAX_PROMPT_CHARS = 500_000; // about 125k tokens, so a whole book stays under a dollar

function prompt(b) {
  const text = b.kind === 'text';
  let lines = b.chunks.map((c, i) => (text ? `[¶${i + 1}] ` : `[${stamp(c.t)}] `) + (c.h ? `## ${c.text}` : c.text)).join('\n');
  const cut = lines.length > MAX_PROMPT_CHARS;
  if (cut) lines = lines.slice(0, MAX_PROMPT_CHARS);
  return [
    `Kind: ${b.type || (text ? 'Article' : 'Video')}`,
    `Title: ${b.title || 'Unknown'}`,
    `${text ? 'Site or author' : 'Channel or show'}: ${b.author || 'Unknown'}`,
    b.description ? `${text ? 'Description' : 'Show notes'}:\n${b.description}` : '',
    b.links?.length ? `Links on the page:\n${b.links.slice(0, 300).join('\n')}` : '',
    `Library tags: ${b.existingTags?.length ? b.existingTags.join(', ') : 'none yet'}`,
    b.topics?.length ? `Being researched: ${b.topics.join('; ')}. Keep the summary true to the whole piece, but make sure anything that bears on this is in the key points.` : '',
    `${text ? 'Text' : 'Transcript'}${cut ? ' (cut short, it is very long)' : ''}:\n${lines}`,
  ].filter(Boolean).join('\n\n');
}

// Keep the summary honest even if the model drifts: timestamps snap to real
// stamps, and a URL survives only if it is in the show notes.
function tidy(s, b) {
  const stamps = b.chunks.map((c) => c.t);
  const n = b.chunks.length;
  const snap = b.kind === 'text'
    ? (t) => (Number.isFinite(t) ? Math.min(n, Math.max(1, Math.round(t))) : 1)
    : (t) => {
      if (!Number.isFinite(t) || !stamps.length) return 0;
      return stamps.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), stamps[0]);
    };
  const notes = String(b.description || '') + '\n' + (b.links || []).join('\n');
  const library = new Set((b.existingTags || []).map((t) => String(t).toLowerCase()));
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const out = {
    title: str(s.title).slice(0, 200),
    brief: str(s.brief),
    keyPoints: (s.keyPoints || []).map((k) => ({ t: snap(k.t), point: str(k.point) })).filter((k) => k.point),
    quotes: (s.quotes || []).map((q) => ({ t: snap(q.t), quote: str(q.quote), speaker: str(q.speaker) })).filter((q) => q.quote),
    mentions: (s.mentions || [])
      .map((m) => ({ t: snap(m.t), name: str(m.name), kind: KINDS.includes(m.kind) ? m.kind : 'other', url: str(m.url) && notes.includes(str(m.url)) ? str(m.url) : '' }))
      .filter((m) => m.name),
    tags: [...new Set((s.tags || []).map((t) => str(t).toLowerCase()).filter(Boolean))].slice(0, 6),
  };
  out.newTags = out.tags.filter((t) => !library.has(t));
  return out;
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
