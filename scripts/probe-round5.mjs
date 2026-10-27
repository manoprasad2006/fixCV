// Dev-only probe round 5: ASR with WAV encoding + model (round 4 finding).
// Reads fixcv/.env. NEVER prints the API key or .env contents.
// Usage: node scripts/probe-round5.mjs
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

function toneWav() {
  const sr = 16000;
  const n = sr;
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVE', 8);
  pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24); pcm.writeUInt32LE(sr * 2, 28);
  pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / sr)), 44 + i * 2);
  }
  return pcm;
}
const wav = toneWav();

const variants = [
  ['WAV+model+lang', { model: 'muse-voice-transcribe-1.0', language: 'en', audioEncoding: 'WAV' }],
  ['WAV+model+lang+rate', { model: 'muse-voice-transcribe-1.0', language: 'en', audioEncoding: 'WAV', sampleRateHertz: 16000 }],
];
for (const [label, req] of variants) {
  console.log(`\n=== asr ${label} ===`);
  console.log('request:', JSON.stringify(req));
  try {
    const form = new FormData();
    form.set('request', JSON.stringify(req));
    form.set('audio', new Blob([wav], { type: 'audio/wav' }), 'tone.wav');
    const res = await fetch(BASE + '/asr/transcribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}` },
      body: form,
    });
    console.log('status:', res.status);
    console.log((await res.text()).slice(0, 800));
  } catch (e) {
    console.log('ERROR:', e.cause?.code || e.message);
  }
}
