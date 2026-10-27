// Dev-only probe: Muse Image generations endpoint (optional overlay).
// Reads fixcv/.env. NEVER prints the API key or .env contents.
// Usage: node scripts/probe-image.mjs
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
if (!KEY) process.exit(2);

console.log('=== POST /images/generations muse-image-1.0 ===');
try {
  const res = await fetch(BASE + '/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'muse-image-1.0',
      prompt: 'A clean bicycle chain properly seated on a sprocket, simple diagram',
      n: 1,
      size: '1024x1024',
    }),
  });
  console.log('status:', res.status);
  const text = await res.text();
  // Print structure only: lengths + url/b64 prefix presence (no huge blobs).
  const data = JSON.parse(text);
  const item = data?.data?.[0] || {};
  console.log('keys:', Object.keys(data).join(','));
  console.log('item keys:', Object.keys(item).join(','));
  if (item.url) console.log('url prefix:', String(item.url).slice(0, 80));
  if (item.b64_json) console.log('b64 len:', item.b64_json.length);
  if (!item.url && !item.b64_json) console.log(text.slice(0, 500));
} catch (e) {
  console.log('ERROR:', e.cause?.code || e.message);
}
