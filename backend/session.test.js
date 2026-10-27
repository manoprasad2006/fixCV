// Session store tests. New work, 2026-10-28.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, getSession, setSteps, advanceStep, appendHistory, summary } from './session.js';

describe('session store', () => {
  it('creates a session with the chosen language', () => {
    const s = createSession('ta');
    assert.equal(s.language, 'ta');
    assert.ok(s.id);
    assert.deepEqual(s.steps, []);
  });
  it('falls back to English for unknown languages', () => {
    assert.equal(createSession('fr').language, 'en');
  });
  it('sets steps and advances to done', () => {
    const s = createSession('en');
    setSteps(s.id, ['Clean the chain', 'Re-seat the chain']);
    let got = getSession(s.id);
    assert.equal(got.steps.length, 2);
    advanceStep(s.id);
    got = getSession(s.id);
    assert.equal(got.steps[0].verified, true);
    assert.equal(got.done, false);
    advanceStep(s.id);
    assert.equal(getSession(s.id).done, true);
  });
  it('returns null for unknown sessions', () => {
    assert.equal(getSession('nope'), null);
    assert.equal(summary('nope'), null);
  });
  it('records history entries', () => {
    const s = createSession('hi');
    appendHistory(s.id, { kind: 'diagnose' });
    assert.equal(getSession(s.id).history.length, 1);
  });
});
