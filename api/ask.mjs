// POST /api/ask  { question, topics[], since, includeSuperseded }
//   -> { answer, sources[{ id, title, author, date, type, notionUrl, sourceUrl }], read, matched }
// Answers a question from the Research library in Notion, with citations.
//   1. Notion: pages matching the topic and date filters.
//   2. With many matches, Claude first picks the most relevant from their summaries.
//   3. Those pages are read in full (summary, show notes, transcript or text) and Claude answers.
import Anthropic from '@anthropic-ai/sdk';
import { checkPasscode, requireEnv, readBody } from './_lib.mjs';
import { notion } from './notion.mjs';

const MODEL = 'claude-opus-5-5';
const MAX_CANDIDATES = 300;
const READ_AT_MOST = 8;             // pages read in full per question
const TEXT_BUDGET = 360_000;        // characters across all pages, about 90k tokens
const NOTION_CONCURRENCY = 3;       // Notion allows about 3 requests a second

const plain = (rich) => (rich || []).map((r) => r.plain_text || '').join('');
const redact = (s) => String(s ?? '').replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[hidden]').slice(0, 500);

function sinceDate(since) {
  const months = { '3m': 3, '6m': 6, '12m': 12 }[since];
  if (!months) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// ── 1. find pages ───────────────────────────────────
async function findPages({ topics, since, includeSuperseded }) {
  const and = [];
  if (topics?.length) and.push({ or: topics.map((t) => ({ property: 'Topic', multi_select: { contains: t } })) });
  if (!includeSuperseded) and.push({ property: 'Status', select: { does_not_equal: 'Superseded' } });

  const pages = [];
  let cursor;
  do {
    const r = await notion(`/databases/${process.env.NOTION_DATABASE_ID}/query`, 'POST', {
      page_size: 100,
      ...(and.length && { filter: { and } }),
      sorts: [{ property: 'Published', direction: 'descending' }],
      ...(cursor && { start_cursor: cursor }),
    });
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && pages.length < MAX_CANDIDATES);

  // Dates are checked here rather than in Notion, so the filter stays shallow:
  // Published when we know it, otherwise the day it was saved.
  const from = sinceDate(since);
  return pages.map((p) => {
    const pr = p.properties || {};
    return {
      pageId: p.id,
      notionUrl: p.url,
      title: plain(pr.Title?.title) || 'Untitled',
      author: plain(pr['Podcast or Channel']?.rich_text),
      date: pr.Published?.date?.start || pr.Added?.date?.start || '',
      type: pr.Type?.select?.name || '',
      status: pr.Status?.select?.name || '',
      sourceUrl: pr['Source URL']?.url || '',
      summary: plain(pr.Summary?.rich_text),
      tags: (pr.Tags?.multi_select || []).map((t) => t.name),
      notes: plain(pr.Notes?.rich_text),
    };
  }).filter((p) => !from || (p.date && p.date.slice(0, 10) >= from))
    .map((p, i) => ({ id: `S${i + 1}`, ...p }));
}

// ── 3. read a page in full ──────────────────────────
const BLOCK_TEXT = {
  heading_1: (b) => `# ${plain(b.heading_1.rich_text)}`,
  heading_2: (b) => `## ${plain(b.heading_2.rich_text)}`,
  heading_3: (b) => `### ${plain(b.heading_3.rich_text)}`,
  paragraph: (b) => plain(b.paragraph.rich_text),
  bulleted_list_item: (b) => `- ${plain(b.bulleted_list_item.rich_text)}`,
  numbered_list_item: (b) => `- ${plain(b.numbered_list_item.rich_text)}`,
  quote: (b) => `> ${plain(b.quote.rich_text).replace(/\n/g, ' ')}`,
};

async function readPage(page, budget) {
  const lines = [];
  let size = 0, cursor;
  do {
    const r = await notion(`/blocks/${page.pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, 'GET');
    for (const b of r.results) {
      const t = BLOCK_TEXT[b.type]?.(b);
      if (!t || !t.replace(/^[#>\-\s]+/, '')) continue;
      lines.push(t);
      size += t.length + 1;
    }
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor && size < budget);
  let text = lines.join('\n');
  if (text.length > budget) text = text.slice(0, budget) + '\n[… the rest is cut for length]';
  return text;
}

async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

// ── Claude ──────────────────────────────────────────
const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY.trim() });

async function ask(params) {
  const msg = await client().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    ...params,
  }).finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to answer that one.'), { status: 422 });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('The answer ran out of room. Try a narrower question.'), { status: 422 });
  console.log('ask usage', msg.usage?.input_tokens, msg.usage?.output_tokens);
  return JSON.parse(msg.content.filter((c) => c.type === 'text').map((c) => c.text).join(''));
}

const card = (p) => [
  `[${p.id}] ${p.title}`,
  [p.type, p.author, p.date && `published ${p.date}`, p.status === 'Superseded' && 'SUPERSEDED'].filter(Boolean).join(' · '),
  p.tags.length ? `Tags: ${p.tags.join(', ')}` : '',
  p.summary ? `Summary: ${p.summary}` : '',
  p.notes ? `Her note: ${p.notes}` : '',
].filter(Boolean).join('\n');

// 2. With many matches, pick the ones worth reading in full.
async function pick(question, pages) {
  if (pages.length <= READ_AT_MOST) return pages;
  const out = await ask({
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: {
        type: 'object', additionalProperties: false, required: ['ids'],
        properties: { ids: { type: 'array', items: { type: 'string' }, description: `Up to ${READ_AT_MOST} source ids, most useful first.` } },
      } },
    },
    system: 'You choose which saved sources are worth reading in full to answer a question. Choose by relevance first, then recency.',
    messages: [{ role: 'user', content: `Question: ${question}\n\nSources:\n\n${pages.map(card).join('\n\n')}` }],
  });
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chosen = (out.ids || []).map((id) => byId.get(id)).filter(Boolean).slice(0, READ_AT_MOST);
  return chosen.length ? chosen : pages.slice(0, READ_AT_MOST);
}

const ANSWER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'sourcesUsed'],
  properties: {
    answer: {
      type: 'string',
      description: 'The answer. Short paragraphs, "- " bullets and "## " subheads only, no other markdown. Cite every claim inline like [S2] or [S1][S4].',
    },
    sourcesUsed: { type: 'array', items: { type: 'string' }, description: 'Ids of the sources cited.' },
  },
};

const SYSTEM = `You answer questions from a brand designer's research library: videos, podcasts, articles and PDFs she saved, each with a summary and its full transcript or text.
Answer only from these sources. Cite each claim with its source id, like [S3]. When the sources disagree, say so. When they don't cover the question, say that plainly and say what they do cover.
Dates matter because the field moves fast: mention when something was published if it changes how much weight it deserves, and treat anything marked SUPERSEDED as out of date.
Name concrete examples, people and companies when the sources give them. Quote sparingly and exactly. Transcript lines start with a timestamp you can mention.
Write plainly, in Australian English, without hype.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method', message: 'Use POST.' });
  if (!checkPasscode(req, res) || !requireEnv(res, 'NOTION_TOKEN', 'NOTION_DATABASE_ID', 'ANTHROPIC_API_KEY')) return;

  const b = readBody(req);
  const question = String(b.question || '').trim().slice(0, 2000);
  if (!question) return res.status(400).json({ error: 'invalid-request', message: 'Ask a question first.' });
  const topics = (Array.isArray(b.topics) ? b.topics : []).map(String).filter(Boolean).slice(0, 10);

  try {
    const pages = await findPages({ topics, since: b.since, includeSuperseded: !!b.includeSuperseded });
    if (!pages.length) {
      return res.json({ answer: 'Nothing in your Research library matches those filters yet.', sources: [], read: 0, matched: 0 });
    }
    const chosen = await pick(question, pages);
    const budget = Math.floor(TEXT_BUDGET / chosen.length);
    const texts = await inBatches(chosen, NOTION_CONCURRENCY, (p) => readPage(p, budget));
    const library = chosen.map((p, i) => `${card(p)}\nSource: ${p.sourceUrl}\n\n${texts[i]}`).join('\n\n=====\n\n');

    const out = await ask({
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${library}\n\n=====\n\nQuestion: ${question}` }],
    });

    const used = new Set([...(out.sourcesUsed || []), ...(String(out.answer).match(/S\d+/g) || [])]);
    const sources = chosen.filter((p) => used.has(p.id)).map(({ id, title, author, date, type, notionUrl, sourceUrl }) => ({ id, title, author, date, type, notionUrl, sourceUrl }));
    return res.json({ answer: String(out.answer || '').trim(), sources, read: chosen.length, matched: pages.length });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: 'not-configured', message: 'The Anthropic API key is wrong or missing.' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'busy', message: 'Claude is busy. Try again in a minute.' });
    if (e instanceof Anthropic.APIError) {
      console.error('anthropic', e.status, redact(e.message));
      return res.status(502).json({ error: 'anthropic', message: `Claude said ${e.status}. Try again.` });
    }
    if (e.code === 'object_not_found') return res.status(404).json({ error: e.code, message: 'Notion cannot see the Research library.' });
    console.error('ask', e?.name, redact(e?.message));
    return res.status(e.status && e.status < 600 ? e.status : 500).json({ error: 'ask', message: e.status === 422 ? e.message : 'Something went wrong answering that. Try again.' });
  }
}
