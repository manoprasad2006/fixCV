// Dev-only probe: Baseten open-weights model IDs + image support.
// Tries the -1026 hackathon ID first, then the changelog ID.
// Reads fixcv/.env. NEVER prints the API key or .env contents.
// Usage: node scripts/probe-baseten.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
// Dev convenience: fall back to the workspace-root .env if the repo one
// lacks a key (the app itself reads fixcv/.env only).
for (const f of [join(root, '..', '.env'), join(root, '.env')]) {
  let text = '';
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const line of text.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) {
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (v) env[m[1]] = v; // non-empty wins; repo .env read last
    }
  }
}
const BASE = (env.BASETEN_BASE_URL || 'https://inference.baseten.co/v1').replace(/\/$/, '');
const KEY = env.BASETEN_API_KEY || '';
console.log('base:', BASE);
console.log('key_present:', KEY.length > 0);
if (!KEY) process.exit(2);

async function chat(model, messages, maxTokens = 200) {
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 600) };
}

const px =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ids = ['meta-models/muse-spark-open-1026', 'meta-models/muse-spark-open'];
let working = null;
for (const id of ids) {
  console.log(`\n=== text model=${id} ===`);
  try {
    const r = await chat(id, [{ role: 'user', content: 'Reply with exactly: PROBE_OK' }]);
    console.log('status:', r.status);
    console.log(r.body);
    if (r.status === 200 && !working) working = id;
  } catch (e) {
    console.log('ERROR:', e.cause?.code || e.message);
  }
  if (working) break;
}
if (working) {
  console.log(`\n=== image model=${working} ===`);
  try {
    const r = await chat(
      working,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Reply with exactly: IMG_OK' },
            { type: 'image_url', image_url: { url: px } },
          ],
        },
      ],
      300,
    );
    console.log('status:', r.status);
    console.log(r.body);
  } catch (e) {
    console.log('ERROR:', e.cause?.code || e.message);
  }
} else {
  console.log('\nNo working Baseten model ID.');
}
