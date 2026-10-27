// Media E2E: drives the FULL trilingual flow from builder-provided files in
// demo/inbox/ (git-ignored, never committed):
//   en-1.* / ta-1.* / hi-1.* : speech clips (any ffmpeg-readable audio)
//   before.*                : broken-object photo (jpg/png) or short video
//   after.*                 : post-fix photo/video (optional; before.* reused if absent)
// Converts audio to 16 kHz WAV via ffmpeg, then per language runs
// /transcribe -> /diagnose (frame+transcript) -> /verify (after frame).
// Prints evidence; exits nonzero only on transport errors.
// Usage (from fixcv/): node scripts/e2e-media.mjs
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inbox = join(root, 'demo', 'inbox');
const PORT = 3459;
const BASE = `http://localhost:${PORT}`;

function fail(msg) {
  console.log('MISSING: ' + msg);
  process.exit(2);
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  fail('ffmpeg not on PATH (needed to convert phone audio/video)');
}
if (!existsSync(inbox)) fail('demo/inbox/ not found');
const files = readdirSync(inbox);
const pick = (prefix) => files.find((f) => f.toLowerCase().startsWith(prefix + '.'));
const clips = { en: pick('en-1'), ta: pick('ta-1'), hi: pick('hi-1') };
for (const [lang, f] of Object.entries(clips)) {
  if (!f) fail(`demo/inbox/${lang}-1.<audio> speech clip`);
}
const before = pick('before');
if (!before) fail('demo/inbox/before.<jpg|png|mp4|mov> broken-object photo/video');
const after = pick('after') || before;

const tmp = join(inbox, '.tmp');
mkdirSync(tmp, { recursive: true });

function toWav16k(src) {
  const out = join(tmp, 'clip.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(inbox, src), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out]);
  return 'data:audio/wav;base64,' + readFileSync(out).toString('base64');
}

function toFrameDataUrl(src) {
  const ext = extname(src).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { url: `data:${mime};base64,${readFileSync(join(inbox, src)).toString('base64')}`, w: 0, h: 0 };
  }
  const out = join(tmp, 'frame.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(inbox, src), '-vframes', '1', out]);
  return { url: 'data:image/png;base64,' + readFileSync(out).toString('base64'), w: 0, h: 0 };
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const show = (label, value) => console.log(`${label}: ${String(value ?? '').slice(0, 500)}`);
const beforeFrame = toFrameDataUrl(before);
const afterFrame = toFrameDataUrl(after);

const server = spawn('node', ['backend/server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
try {
  await new Promise((r) => setTimeout(r, 2000));
  for (const lang of ['en', 'ta', 'hi']) {
    console.log(`\n##### language=${lang} clip=${clips[lang]} #####`);
    const s = await post('/session', { language: lang });
    if (!s.data.id) {
      show('session ERROR', JSON.stringify(s.data));
      continue;
    }
    const tr = await post('/transcribe', { sessionId: s.data.id, audio: toWav16k(clips[lang]) });
    show('transcript', tr.data.text || JSON.stringify(tr.data));
    if (tr.data.stopped) {
      show('STOP', `${tr.data.category}: ${tr.data.message}`);
      continue;
    }
    const dg = await post('/diagnose', {
      sessionId: s.data.id,
      transcript: tr.data.text || '',
      image: beforeFrame.url,
    });
    if (dg.data.stopped) {
      show('STOP', `${dg.data.category}: ${dg.data.message}`);
      continue;
    }
    if (dg.data.question) {
      show('gate question', dg.data.question);
      continue;
    }
    show('cause', dg.data.cause);
    show('steps', `${dg.data.steps?.length} :: ${(dg.data.steps || []).join(' | ')}`);
    const vf = await post('/verify', { sessionId: s.data.id, image: afterFrame.url });
    show('verify', `${vf.data.status}: ${vf.data.message}`);
  }
} finally {
  server.kill();
}
console.log('\ne2e-media: done');
