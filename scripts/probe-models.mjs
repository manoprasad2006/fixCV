// Dev-only probe: verifies Meta Model API model IDs and request formats.
// Reads fixcv/.env. NEVER prints the API key or .env contents.
// Usage: node scripts/probe-models.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const BASE = (env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
const KEY = env.MODEL_API_KEY || '';
console.log('base:', BASE);
console.log('key_present:', KEY.length > 0, 'key_len:', KEY.length);
if (!KEY) process.exit(2);

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 1200) };
}

// 1. List models (OpenAI-compatible discovery)
console.log('\n=== GET /models ===');
try {
  const r = await call('GET', '/models');
  console.log('status:', r.status);
  console.log(r.body);
} catch (e) {
  console.log('ERROR:', e.cause?.code || e.message);
}

// 2. Chat candidates with a 1px image (tests multimodal input)
const px =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const candidates = ['muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1'];
for (const id of candidates) {
  console.log(`\n=== POST /chat/completions model=${id} ===`);
  try {
    const r = await call('POST', '/chat/completions', {
      model: id,
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Reply with exactly: PROBE_OK' },
            { type: 'image_url', image_url: { url: px } },
          ],
        },
      ],
    });
    console.log('status:', r.status);
    console.log(r.body);
  } catch (e) {
    console.log('ERROR:', e.cause?.code || e.message);
  }
}
