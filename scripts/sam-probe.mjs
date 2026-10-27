// Dev-only SAM 3.1 probe: synthetic PNG + concept prompt + point prompt.
// Shape from official docs (ai.developer.meta.com/docs/sam/*), verified here.
// Reads fixcv/.env. NEVER prints the API key or .env contents.
// Usage: node scripts/sam-probe.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redSquarePng } from './lib/png.mjs';
import {
  buildObjectPrompt,
  parseImageStream,
  recordsOfKind,
  decodeMaskToRaster,
  decodeMaskToRLE,
} from '@meta-sam/parser';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const BASE = (env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
const KEY = env.MODEL_API_KEY || '';
if (!KEY) process.exit(2);

// White 320x240 with a solid red square (80,60)-(240,180)
const W = 320;
const H = 240;
const png = redSquarePng();
const dataUrl = 'data:image/png;base64,' + png.toString('base64');
console.log('test image bytes:', png.length);

async function* sseEvents(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch { /* keep-alive */ }
    }
  }
}

async function segment(label, promptText) {
  console.log(`\n=== ${label} ===`);
  console.log('prompt:', promptText.slice(0, 160));
  const res = await fetch(BASE + '/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: 'sam-3.1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: promptText },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
      stream: true,
    }),
  });
  console.log('http status:', res.status);
  if (!res.ok) {
    console.log((await res.text()).slice(0, 500));
    return;
  }
  const result = await parseImageStream(sseEvents(res)).finalResult;
  const boxes = recordsOfKind(result.records, 'box');
  const masks = recordsOfKind(result.records, 'mask');
  console.log('boxes:', boxes.length, 'masks:', masks.length);
  for (const b of boxes.slice(0, 4)) {
    console.log(`  box id=${b.objectId} l=${b.left} t=${b.top} r=${b.right} b=${b.bottom}`);
  }
  const m0 = masks[0];
  if (m0) {
    const raster = decodeMaskToRaster(m0.mask);
    const ones = raster.reduce((a, v) => a + v, 0);
    console.log(`  mask0 raster len=${raster.length} ones=${ones}`);
    const rle = decodeMaskToRLE(m0.mask);
    console.log(`  mask0 rle size=${JSON.stringify(rle.size)} counts_len=${rle.counts.length}`);
  }
}

await segment('concept: red square', 'red square');

const pt = buildObjectPrompt({
  size: { width: W, height: H },
  objects: [{ id: 1, prompts: [{ points: [{ x: 160, y: 120 }] }] }],
});
await segment('point at square center', pt);
