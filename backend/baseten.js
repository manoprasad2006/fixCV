// FixCV Baseten client (open-weights bonus path). OpenAI-compatible
// POST /chat/completions. Model ID VERIFIED by probe-baseten (see
// docs/api-notes.md): the -1026 hackathon ID 404s; the changelog ID works,
// including image input. New work, 2026-10-28.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = { ...process.env };
  const p = join(ROOT, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
export const BASETEN_BASE = (env.BASETEN_BASE_URL || 'https://inference.baseten.co/v1').replace(/\/$/, '');
export const OPEN_MODEL = env.MUSE_SPARK_OPEN_MODEL || 'meta-models/muse-spark-open';
const KEY = env.BASETEN_API_KEY || '';

/** True when the open-weights path is selected AND keyed. */
export function openModelEnabled() {
  return String(env.USE_OPEN_MODEL || '').toLowerCase() === 'true' && KEY.length > 0;
}

/** Chat completion on the open model (text + optional data-URL image). */
export async function openChat(messages, { model = OPEN_MODEL, maxTokens = 1500 } = {}) {
  if (!KEY) throw new Error('BASETEN_API_KEY is not set (fixcv/.env)');
  const res = await fetch(`${BASETEN_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Baseten ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  let content = data?.choices?.[0]?.message?.content;
  if (!content) {
    // The open model reasons verbosely and can exhaust the budget before
    // answering. Retry once with double the budget.
    const retry = await fetch(`${BASETEN_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens * 2, messages }),
    });
    const rdata = await retry.json().catch(() => ({}));
    if (!retry.ok) {
      throw new Error(`Baseten ${retry.status}: ${JSON.stringify(rdata).slice(0, 300)}`);
    }
    content = rdata?.choices?.[0]?.message?.content;
  }
  if (!content) throw new Error('Empty reply from open model (content null)');
  return content;
}
