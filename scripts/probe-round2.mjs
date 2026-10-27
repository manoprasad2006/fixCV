// Dev-only probe round 2: Spark content output, model metadata, ASR shape.
// Reads fixcv/.env. NEVER prints the API key or .env contents.
// Usage: node scripts/probe-round2.mjs
import { readFileSync, writeFileSync } from 'node:fs';
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
const H = { Authorization: `Bearer ${KEY}` };
if (!KEY) process.exit(2);

async function call(label, method, path, opts = {}) {
  console.log(`\n=== ${label} ${method} ${path} ===`);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...H, ...(opts.json ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body,
    });
    console.log('status:', res.status);
    console.log((await res.text()).slice(0, 1000));
  } catch (e) {
    console.log('ERROR:', e.cause?.code || e.message);
  }
}

// 1. Spark 1.3 text-only with room for reasoning + content
await call('spark13-text', 'POST', '/chat/completions', {
  json: true,
  body: JSON.stringify({
    model: 'muse-spark-1.3',
    max_tokens: 300,
    messages: [{ role: 'user', content: 'Reply with exactly: PROBE_OK' }],
  }),
});

// 2. Spark 1.3 with a 1px image
const px =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
await call('spark13-image', 'POST', '/chat/completions', {
  json: true,
  body: JSON.stringify({
    model: 'muse-spark-1.3',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What size is this image? Reply briefly.' },
          { type: 'image_url', image_url: { url: px } },
        ],
      },
    ],
  }),
});

// 3. Model metadata lookups (may reveal endpoint hints)
await call('meta-sam', 'GET', '/models/sam-3.1');
await call('meta-asr', 'GET', '/models/muse-voice-transcribe-1.0');

// 4. ASR file endpoint with a generated 16kHz tone WAV (multipart)
const sr = 16000;
const n = sr; // 1 second
const pcm = Buffer.alloc(44 + n * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20);
pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28);
pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36);
pcm.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  pcm.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sr)), 44 + i * 2);
}
const wavPath = join(root, 'scripts', 'probe-tone.wav');
writeFileSync(wavPath, pcm);
const form = new FormData();
form.set('model', 'muse-voice-transcribe-1.0');
form.set('language', 'en');
form.set('file', new Blob([pcm], { type: 'audio/wav' }), 'probe-tone.wav');
await call('asr-file', 'POST', '/asr/transcribe', { body: form });
