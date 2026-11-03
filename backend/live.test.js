// Live-session helper tests (tap-to-talk + frame sampling logic).
// New work, 2026-11-03.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmsEnergy, isSpeech, shouldStopTalking, shouldSampleFrame } from '../shared/live.js';

describe('live helpers', () => {
  it('computes RMS energy', () => {
    assert.equal(rmsEnergy(new Float32Array(0)), 0);
    assert.ok(Math.abs(rmsEnergy(new Float32Array([1, -1, 1, -1])) - 1) < 1e-6);
    assert.ok(rmsEnergy(new Float32Array([0.01, 0.01])) < 0.02);
  });
  it('detects speech above threshold', () => {
    assert.equal(isSpeech(0.05), true);
    assert.equal(isSpeech(0.01), false);
    assert.equal(isSpeech(0.02), true);
  });
  it('stops talking only after min time + sustained silence', () => {
    assert.equal(shouldStopTalking(1500, 500), false); // too early
    assert.equal(shouldStopTalking(500, 2000), false); // not silent long enough
    assert.equal(shouldStopTalking(1200, 2000), true);
  });
  it('throttles frame sampling', () => {
    assert.equal(shouldSampleFrame(5000, 0), true);
    assert.equal(shouldSampleFrame(2000, 0), false);
    assert.equal(shouldSampleFrame(4000, 0), true);
  });
});
