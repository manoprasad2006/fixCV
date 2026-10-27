// FixCV in-memory session store. No database. New work, 2026-10-28.
import { randomUUID } from 'node:crypto';

const LANGS = new Set(['en', 'ta', 'hi']);
const sessions = new Map();

/**
 * Create a session. Language is stored for the session and never
 * switched mid-sentence: one language per session.
 */
export function createSession(language = 'en') {
  const lang = LANGS.has(language) ? language : 'en';
  const session = {
    id: randomUUID(),
    language: lang,
    createdAt: Date.now(),
    steps: [],
    currentStep: 0,
    done: false,
    history: [],
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id) {
  return sessions.get(id) ?? null;
}

/** Replace the step list (fresh diagnosis) and reset progress. */
export function setSteps(id, steps) {
  const s = sessions.get(id);
  if (!s) return null;
  s.steps = steps.map((text, i) => ({ index: i, text, verified: false }));
  s.currentStep = 0;
  s.done = false;
  return s;
}

/** Mark the current step verified and advance; finish when past the end. */
export function advanceStep(id) {
  const s = sessions.get(id);
  if (!s) return null;
  const cur = s.steps[s.currentStep];
  if (cur) cur.verified = true;
  s.currentStep += 1;
  if (s.currentStep >= s.steps.length) s.done = true;
  return s;
}

export function appendHistory(id, entry) {
  const s = sessions.get(id);
  if (!s) return null;
  s.history.push({ at: Date.now(), ...entry });
  return s;
}

export function summary(id) {
  const s = sessions.get(id);
  if (!s) return null;
  return {
    id: s.id,
    language: s.language,
    steps: s.steps,
    currentStep: s.currentStep,
    done: s.done,
  };
}
