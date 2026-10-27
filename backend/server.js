// FixCV backend: one small zero-dependency Node server.
// Endpoints: /session, /diagnose, /verify, /segment*, /transcribe*.
// (* 501 until the SAM 3.1 / ASR endpoints are verified — see docs/api-notes.md)
// Safety runs BEFORE every model call and AGAIN on every model output.
// New work, 2026-10-28.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHardStop } from './safety.js';
import { createSession, getSession, setSteps, advanceStep, appendHistory, summary } from './session.js';
import { sparkChat, renderPrompt, userMessage, transcribe } from './meta.js';
import { segmentAtPoint } from './sam.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 6 * 1024 * 1024; // frames arrive as data URLs

const LANG_NAMES = { en: 'English', ta: 'Tamil', hi: 'Hindi' };

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function locale(lang, key) {
  try {
    const strings = JSON.parse(readFileSync(join(ROOT, 'locales', `${lang}.json`), 'utf8'));
    return key.split('.').reduce((o, k) => o?.[k], strings);
  } catch {
    return null;
  }
}

function stopResponse(lang, category) {
  return {
    stopped: true,
    category,
    title: locale(lang, 'stop.title'),
    message: locale(lang, `stop.${category}`) || locale(lang, 'stop.generic'),
  };
}

function parseDiagnose(text) {
  const t = String(text).trim();
  if (/^UNSAFE:/i.test(t)) return { unsafe: t.replace(/^UNSAFE:\s*/i, '') };
  if (/^NEEDS_MORE_INFO:/i.test(t)) return { question: t.replace(/^NEEDS_MORE_INFO:\s*/i, '') };
  const cause = (t.match(/^CAUSE:\s*(.+)$/im) || [])[1]?.trim() || '';
  const steps = [...t.matchAll(/^\s*\d+[.)]\s*(.+)$/gim)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return { cause, steps };
}

function parseVerify(text) {
  const t = String(text).trim();
  if (/^UNSAFE:/i.test(t)) return { status: 'unsafe', message: t.replace(/^UNSAFE:\s*/i, '') };
  if (/^CONFIRMED:/i.test(t)) return { status: 'confirmed', message: t.replace(/^CONFIRMED:\s*/i, '') };
  if (/^CORRECTION:/i.test(t)) return { status: 'correction', message: t.replace(/^CORRECTION:\s*/i, '') };
  if (/^UNCLEAR:/i.test(t)) return { status: 'unclear', message: t.replace(/^UNCLEAR:\s*/i, '') };
  return { status: 'correction', message: t };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function serveStatic(reqUrl, res) {
  let rel = reqUrl === '/' ? '/index.html' : reqUrl;
  const file = normalize(join(ROOT, 'frontend', '.' + rel));
  if (!file.startsWith(join(ROOT, 'frontend'))) return send(res, 403, { error: 'forbidden' });
  // Locales and shared JS modules are served too.
  const rootFile = normalize(join(ROOT, '.' + rel));
  const target = existsSync(file)
    ? file
    : (rel.startsWith('/locales/') || rel.startsWith('/shared/')) && existsSync(rootFile)
      ? rootFile
      : null;
  if (!target) return send(res, 404, { error: 'not_found' });
  const ext = target.slice(target.lastIndexOf('.'));
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(target));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && !url.pathname.startsWith('/session')) {
      return serveStatic(url.pathname, res);
    }
    if (req.method === 'GET' && url.pathname === '/session') {
      const s = summary(url.searchParams.get('id'));
      return s ? send(res, 200, s) : send(res, 404, { error: 'no_session' });
    }
    if (req.method === 'POST' && url.pathname === '/session') {
      const { language } = await readJson(req);
      const s = createSession(language);
      return send(res, 200, { id: s.id, language: s.language });
    }
    if (req.method === 'POST' && url.pathname === '/diagnose') {
      const { sessionId, transcript = '', image = null } = await readJson(req);
      const s = getSession(sessionId);
      if (!s) return send(res, 404, { error: 'no_session' });
      const pre = checkHardStop(transcript);
      if (pre.stopped) return send(res, 200, stopResponse(s.language, pre.category));
      const prompt = renderPrompt('diagnose.txt', {
        language: s.language,
        language_name: LANG_NAMES[s.language],
        transcript,
      });
      const reply = await sparkChat([userMessage(prompt, image)]);
      const post = checkHardStop(reply);
      if (post.stopped) return send(res, 200, stopResponse(s.language, post.category));
      const parsed = parseDiagnose(reply);
      if (parsed.unsafe) return send(res, 200, { stopped: true, category: 'model', message: parsed.unsafe });
      appendHistory(sessionId, { kind: 'diagnose', transcript: String(transcript).slice(0, 500) });
      if (parsed.question) return send(res, 200, { stopped: false, question: parsed.question });
      if (!parsed.steps.length) return send(res, 200, { stopped: false, question: reply.slice(0, 500) });
      setSteps(sessionId, parsed.steps);
      return send(res, 200, { stopped: false, cause: parsed.cause, steps: parsed.steps });
    }
    if (req.method === 'POST' && url.pathname === '/verify') {
      const { sessionId, image = null, note = '' } = await readJson(req);
      const s = getSession(sessionId);
      if (!s) return send(res, 404, { error: 'no_session' });
      const cur = s.steps[s.currentStep];
      if (!cur) return send(res, 200, { done: true });
      const pre = checkHardStop(note);
      if (pre.stopped) return send(res, 200, stopResponse(s.language, pre.category));
      const prompt = renderPrompt('verify.txt', {
        language: s.language,
        language_name: LANG_NAMES[s.language],
        step_text: `Step ${s.currentStep + 1}: ${cur.text}`,
        note,
      });
      const reply = await sparkChat([userMessage(prompt, image)]);
      const post = checkHardStop(reply);
      if (post.stopped) return send(res, 200, stopResponse(s.language, post.category));
      const parsed = parseVerify(reply);
      if (parsed.status === 'unsafe') return send(res, 200, { stopped: true, category: 'model', message: parsed.message });
      appendHistory(sessionId, { kind: 'verify', step: s.currentStep, status: parsed.status });
      if (parsed.status === 'confirmed') {
        const updated = advanceStep(sessionId);
        return send(res, 200, { status: 'confirmed', message: parsed.message, done: updated.done, nextStep: updated.steps[updated.currentStep]?.text ?? null });
      }
      return send(res, 200, { status: parsed.status, message: parsed.message, done: false });
    }
    if (req.method === 'POST' && url.pathname === '/segment') {
      const { sessionId, image = '', x = 0.5, y = 0.5, w = 0, h = 0 } = await readJson(req);
      const s = getSession(sessionId);
      if (!s) return send(res, 404, { error: 'no_session' });
      if (!String(image).startsWith('data:image/')) {
        return send(res, 400, { error: 'bad_image', reason: 'Send a frame as an image data URL.' });
      }
      const out = await segmentAtPoint(image, x, y, w, h);
      appendHistory(sessionId, { kind: 'segment', masks: out.masks.length });
      return send(res, 200, out);
    }
    if (req.method === 'POST' && url.pathname === '/transcribe') {
      const { sessionId, audio = '' } = await readJson(req);
      const s = getSession(sessionId);
      if (!s) return send(res, 404, { error: 'no_session' });
      const m = String(audio).match(/^data:(audio\/(?:wav|x-wav));base64,(.+)$/);
      if (!m) return send(res, 400, { error: 'unsupported_audio', reason: 'Send a 16 kHz WAV data URL.' });
      const text = await transcribe(Buffer.from(m[2], 'base64'), { language: s.language });
      appendHistory(sessionId, { kind: 'transcribe', chars: text.length });
      const gate = checkHardStop(text);
      if (gate.stopped) return send(res, 200, { text, ...stopResponse(s.language, gate.category) });
      return send(res, 200, { text });
    }
    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    return send(res, 500, { error: 'server_error', message: String(err.message || err).slice(0, 300) });
  }
});

server.listen(PORT, () => console.log(`FixCV backend on http://localhost:${PORT}`));
