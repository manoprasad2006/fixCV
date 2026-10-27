// FixCV SAM 3.1 client. Uses the VERIFIED Responses API shape
// (see docs/api-notes.md section 5): POST /responses, model sam-3.1,
// point prompts built with @meta-sam/parser, masks returned as COCO RLE.
// New work, 2026-10-28.
import {
  buildObjectPrompt,
  parseImageStream,
  recordsOfKind,
  decodeMaskToRLE,
} from '@meta-sam/parser';
import { META_BASE } from './meta.js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function apiKey() {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY;
  const p = join(ROOT, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*MODEL_API_KEY\s*=\s*(.*)\s*$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

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

/**
 * Segment the object at a tap point.
 * @param {string} imageDataUrl frame (data URL)
 * @param {number} xNorm tap x, 0..1
 * @param {number} yNorm tap y, 0..1
 * @param {number} width frame width in pixels
 * @param {number} height frame height in pixels
 * @returns {Promise<{masks: Array<{id:number, box:object, rle:object, frame:object}>}>}
 */
export async function segmentAtPoint(imageDataUrl, xNorm, yNorm, width, height) {
  const KEY = apiKey();
  if (!KEY) throw new Error('MODEL_API_KEY is not set (fixcv/.env)');
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error('segment needs frame width/height in pixels');
  }
  const px = Math.min(w - 1, Math.max(0, Math.round(Number(xNorm) * w)));
  const py = Math.min(h - 1, Math.max(0, Math.round(Number(yNorm) * h)));
  const prompt = buildObjectPrompt({
    size: { width: w, height: h },
    objects: [{ id: 1, prompts: [{ points: [{ x: px, y: py }] }] }],
  });
  const res = await fetch(`${META_BASE}/responses`, {
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
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        },
      ],
      stream: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`SAM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const result = await parseImageStream(sseEvents(res)).finalResult;
  const boxes = recordsOfKind(result.records, 'box');
  const masks = recordsOfKind(result.records, 'mask');
  const byId = new Map(masks.map((m) => [m.objectId, m]));
  return {
    masks: boxes.map((b) => {
      const m = byId.get(b.objectId);
      return {
        id: b.objectId,
        box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        rle: m ? decodeMaskToRLE(m.mask) : null,
        frame: { w, h },
      };
    }),
  };
}
