// FixCV Meta Model API client. Only the VERIFIED request shape is used
// (see docs/api-notes.md): OpenAI-compatible POST /chat/completions with
// Bearer MODEL_API_KEY. New work, 2026-10-28.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = { ...process.env };
  const p = join(ROOT, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
export const META_BASE = (env.META_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
// muse-spark-1.3 verified live on 2026-10-28; override via MUSE_SPARK_MODEL.
export const SPARK_MODEL = env.MUSE_SPARK_MODEL || 'muse-spark-1.3';
const KEY = env.MODEL_API_KEY || '';

function assertKey() {
  if (!KEY) throw new Error('MODEL_API_KEY is not set (fixcv/.env)');
}

/**
 * Chat completion with optional image (data URL).
 * max_tokens must be generous: Spark spends tokens on hidden reasoning
 * before producing content (verified: 60 tokens -> content null).
 */
export async function sparkChat(messages, { model = SPARK_MODEL, maxTokens = 2000 } = {}) {
  assertKey();
  const res = await fetch(`${META_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Meta API ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty reply from model (content null)');
  return content;
}

/** Render a prompts/*.txt template with {{var}} substitution. */
export function renderPrompt(name, vars) {
  let tpl = readFileSync(join(ROOT, 'prompts', name), 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    tpl = tpl.replaceAll(`{{${k}}}`, String(v ?? ''));
  }
  return tpl;
}

/**
 * Speech-to-text via the VERIFIED file endpoint (see docs/api-notes.md):
 * POST {BASE}/asr/transcribe, multipart parts `request` (JSON:
 * {model, language, audioEncoding}) + `audio` (WAV bytes).
 * Returns the transcript string (may be '' for non-speech).
 */
export async function transcribe(wavBuffer, { language = 'en' } = {}) {
  assertKey();
  const form = new FormData();
  form.set(
    'request',
    JSON.stringify({
      model: 'muse-voice-transcribe-1.0',
      language,
      audioEncoding: 'WAV',
      sampleRateHertz: 16000,
    }),
  );
  form.set('audio', new Blob([wavBuffer], { type: 'audio/wav' }), 'speech.wav');
  const res = await fetch(`${META_BASE}/asr/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`ASR ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return String(data?.transcript ?? '');
}

/** Build a user message with optional frame image (data URL). */
export function userMessage(text, imageDataUrl) {
  if (!imageDataUrl) return { role: 'user', content: text };
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  };
}
