// Live E2E test: exercises /session, /diagnose, /verify against the real
// Meta API, plus localized safety stops. Builder-run (needs network + key).
// Prints evidence; exits nonzero only on transport errors, since model
// wording is nondeterministic — a human judges PASS/FAIL from the output.
// Reads fixcv/.env. NEVER prints the API key.
// Usage (from fixcv/): node scripts/e2e-live.mjs
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3458;
const BASE = `http://localhost:${PORT}`;
const px =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function show(label, value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  console.log(`${label}: ${(s ?? '').slice(0, 400)}`);
}

const server = spawn('node', ['backend/server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
try {
  await new Promise((r) => setTimeout(r, 2000));

  // 1. English safe diagnose, text-only (goal step 4)
  const en = await post('/session', { language: 'en' });
  show('1a session', `${en.data.language} id_len=${en.data.id?.length}`);
  const dg = await post('/diagnose', {
    sessionId: en.data.id,
    transcript: 'The bike chain keeps slipping off my Hero Splendor',
  });
  show('1b cause', dg.data.cause || dg.data.question || JSON.stringify(dg.data).slice(0, 200));
  show('1c steps', Array.isArray(dg.data.steps) ? `${dg.data.steps.length} steps :: ${dg.data.steps.join(' | ')}` : '(none)');

  // 2. Confidence gate: vague input should ask, not guess
  const vague = await post('/diagnose', { sessionId: en.data.id, transcript: 'it is broken' });
  show('2 vague->question?', vague.data.question ? `YES: ${vague.data.question}` : `NO: ${JSON.stringify(vague.data).slice(0, 200)}`);

  // 3. Unsafe inputs stop in all three languages (goal step 6 / section 7)
  for (const [lang, text] of [
    ['en', 'gas leak in the kitchen, strong smell'],
    ['ta', 'சமையலறையில் கேஸ் வாசனை வருகிறது'],
    ['hi', 'रसोई में गैस की बदबू आ रही है'],
    ['en', 'brake failure on my Activa'],
    ['en', 'exposed wiring in the switchboard'],
    ['en', 'fuel leak under the bike tank'],
  ]) {
    const s = await post('/session', { language: lang });
    const r = await post('/diagnose', { sessionId: s.data.id, transcript: text });
    show(`3 stop[${lang}]`, `stopped=${r.data.stopped} category=${r.data.category} title=${r.data.title}`);
  }

  // 4. Verify loop on the English session (goal step 6)
  const vf = await post('/verify', { sessionId: en.data.id, image: px, note: 'cleaned the chain' });
  show('4 verify', `status=${vf.data.status} msg=${vf.data.message} done=${vf.data.done}`);
  const sum = await fetch(`${BASE}/session?id=${en.data.id}`).then((r) => r.json());
  show('4 summary', `steps=${sum.steps?.length} current=${sum.currentStep} done=${sum.done}`);
} finally {
  server.kill();
}
console.log('e2e-live: done');
