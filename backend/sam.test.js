// SAM client + RLE helper tests (offline; live calls live in sam-probe).
// New work, 2026-10-28.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildObjectPrompt } from '@meta-sam/parser';
import { decodeRleToRaster } from '../shared/rle.js';

describe('sam prompt', () => {
  it('builds a point prompt with frame marker and dims', () => {
    const pt = buildObjectPrompt({
      size: { width: 320, height: 240 },
      objects: [{ id: 1, prompts: [{ points: [{ x: 160, y: 120 }] }] }],
    });
    assert.equal(pt, '<0f>1<|point;x=160;y=120;w=320;h=240|>');
  });
});

describe('rle decode', () => {
  it('decodes column-major COCO counts to row-major raster', () => {
    // 2 wide x 3 tall, all ones: zero zeros then six ones.
    const { data, width, height } = decodeRleToRaster({ size: [3, 2], counts: [0, 6] });
    assert.equal(width, 2);
    assert.equal(height, 3);
    assert.deepEqual([...data], [1, 1, 1, 1, 1, 1]);
  });
  it('places a single column-major one correctly', () => {
    // 2x2, only (x=1,y=0) set: column-major index 2 -> counts [2,1,1].
    const { data } = decodeRleToRaster({ size: [2, 2], counts: [2, 1, 1] });
    assert.deepEqual([...data], [0, 1, 0, 0]);
  });
});
