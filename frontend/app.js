/* FixCV chat frontend: one continuous conversation — camera card, thread,
   contextual chips, composer with mic. Replies stream word-by-word.
   Zero dependencies. All user-facing strings come from /locales/*.json.
   New work, 2026-10-28. */
'use strict';

import { decodeRleToRaster } from '/shared/rle.js';

const $ = (id) => document.getElementById(id);
const state = {
  lang: 'en', strings: null, sessionId: null, frame: null,
  media: null, recording: null, tracking: false, trackTimer: null, trackXY: null,
  steps: [], currentStep: 0, busy: false,
};
const SPEECH_LANG = { en: 'en-US', ta: 'ta-IN', hi: 'hi-IN' };

function t(key) {
  return state.strings?.ui?.[key] || key;
}

function show(id) {
  for (const s of ['screen-lang', 'screen-chat', 'screen-stop']) $(s).hidden = s !== id;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (id !== 'screen-chat' && state.tracking) stopTracking();
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = SPEECH_LANG[state.lang] || 'en-US';
  window.speechSynthesis.speak(u);
}

/* ---------- thread rendering ---------- */
function scrollDown() {
  const th = $('thread');
  th.scrollTop = th.scrollHeight;
}

function userBubble(text, imgUrl) {
  const d = document.createElement('div');
  d.className = 'msg user';
  if (imgUrl) {
    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = '';
    d.appendChild(img);
  }
  d.appendChild(document.createTextNode(text));
  $('thread').appendChild(d);
  scrollDown();
  return d;
}

function aiBubble() {
  const d = document.createElement('div');
  d.className = 'msg ai streaming';
  d.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  $('thread').appendChild(d);
  scrollDown();
  return d;
}

function aiCard(html) {
  const d = document.createElement('div');
  d.className = 'msg ai';
  d.innerHTML = html;
  $('thread').appendChild(d);
  scrollDown();
  return d;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function listenButton(playText) {
  return `<br><button class="msgbtn small" data-listen>${esc(t('listen'))}</button>`;
}

function setChips(chips) {
  // chips: [{label, fn}]
  const box = $('chips');
  box.innerHTML = '';
  for (const c of chips) {
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = c.label;
    b.addEventListener('click', c.fn);
    box.appendChild(b);
  }
}

$('thread').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-listen]');
  if (b) speak(b.closest('.msg').innerText);
});

/* ---------- server calls ---------- */
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || data.error || `HTTP ${res.status}`);
  return data;
}

async function streamApi(path, body, onDelta) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && data.error === 'not_found' && path.endsWith('/stream')) {
      return api(path.slice(0, -'/stream'.length), body); // old server: JSON fallback
    }
    throw new Error(data.reason || data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop();
    for (const block of blocks) {
      let event = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'delta' && data) {
        try {
          onDelta(JSON.parse(data).text || '');
        } catch { /* partial */ }
      } else if (event === 'result' && data) {
        try {
          result = JSON.parse(data);
        } catch { /* ignore */ }
      }
    }
  }
  return result;
}

/* ---------- language + session ---------- */
async function initLang() {
  const [en, ta, hi] = await Promise.all([
    fetch('/locales/en.json').then((r) => r.json()),
    fetch('/locales/ta.json').then((r) => r.json()),
    fetch('/locales/hi.json').then((r) => r.json()),
  ]);
  $('tagline').textContent = en.ui.tagline;
  $('disclaimerEn').textContent = en.disclaimer;
  $('disclaimerTa').textContent = ta.disclaimer;
  $('disclaimerHi').textContent = hi.disclaimer;
  $('chooseLanguage').textContent = en.ui.chooseLanguage;
  document.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => startSession(b.dataset.lang)),
  );
}

async function startSession(lang) {
  const strings = await fetch(`/locales/${lang}.json`).then((r) => r.json());
  state.lang = lang;
  state.strings = strings;
  document.documentElement.lang = lang;
  const s = await api('/session', { language: lang });
  state.sessionId = s.id;
  $('appName').textContent = strings.ui.appName;
  $('langBadge').textContent = strings.language_name;
  $('btnRestart').hidden = false;
  $('btnRestart').textContent = strings.ui.newSession;
  $('tapPrompt').textContent = strings.ui.tapPrompt;
  $('msgInput').placeholder = strings.ui.describePlaceholder;
  $('btnMic').textContent = strings.ui.speak;
  $('btnSend').textContent = strings.ui.send;
  $('btnTrack').textContent = strings.ui.track;
  await startCamera();
  show('screen-chat');
}

$('btnRestart').addEventListener('click', () => location.reload());

/* ---------- camera + tap + track ---------- */
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  state.media = stream;
  $('video').srcObject = stream;
}

function captureFrame(maxDim = 960) {
  const v = $('video');
  const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  state.frameW = c.width;
  state.frameH = c.height;
  return c.toDataURL('image/jpeg', 0.8);
}

function drawTap(x, y) {
  const ov = $('overlay');
  const v = $('video');
  ov.width = v.clientWidth;
  ov.height = v.clientHeight;
  const ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, ov.width, ov.height);
  ctx.strokeStyle = '#ffd60a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  ctx.stroke();
}

function drawMasks(masks) {
  const ov = $('overlay');
  const v = $('video');
  ov.width = v.clientWidth;
  ov.height = v.clientHeight;
  const ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, ov.width, ov.height);
  for (const m of masks) {
    const fw = m.frame?.w || state.frameW;
    const fh = m.frame?.h || state.frameH;
    const sx = ov.width / fw;
    const sy = ov.height / fh;
    if (m.rle) {
      const { data, width, height } = decodeRleToRaster(m.rle);
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const octx = off.getContext('2d');
      const img = octx.createImageData(width, height);
      for (let i = 0; i < data.length; i++) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = 214;
        img.data[i * 4 + 2] = 10;
        img.data[i * 4 + 3] = data[i] ? 110 : 0;
      }
      octx.putImageData(img, 0, 0);
      ctx.drawImage(off, 0, 0, ov.width, ov.height);
    }
    if (m.box) {
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = 3;
      ctx.strokeRect(m.box.left * sx, m.box.top * sy, (m.box.right - m.box.left) * sx, (m.box.bottom - m.box.top) * sy);
    }
  }
}

$('overlay').addEventListener('click', async (ev) => {
  const r = ev.target.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width;
  const y = (ev.clientY - r.top) / r.height;
  drawTap(ev.clientX - r.left, ev.clientY - r.top);
  state.frame = captureFrame();
  state.trackXY = { x, y };
  $('segStatus').textContent = '…';
  try {
    const res = await api('/segment', {
      sessionId: state.sessionId,
      image: state.frame,
      x, y,
      w: state.frameW,
      h: state.frameH,
    });
    drawMasks(res.masks || []);
    $('segStatus').textContent = `${(res.masks || []).length} region(s)`;
  } catch (err) {
    $('segStatus').textContent = String(err.message || err).slice(0, 160);
  }
});

async function trackOnce() {
  if (!state.trackXY) return;
  try {
    const frame = captureFrame();
    state.frame = frame;
    const res = await api('/segment', {
      sessionId: state.sessionId,
      image: frame,
      x: state.trackXY.x,
      y: state.trackXY.y,
      w: state.frameW,
      h: state.frameH,
    });
    drawMasks(res.masks || []);
    $('segStatus').textContent = `${(res.masks || []).length} region(s)`;
  } catch (err) {
    $('segStatus').textContent = String(err.message || err).slice(0, 160);
  }
}

function stopTracking() {
  state.tracking = false;
  if (state.trackTimer) clearInterval(state.trackTimer);
  state.trackTimer = null;
  if (state.strings) $('btnTrack').textContent = state.strings.ui.track;
}

$('btnTrack').addEventListener('click', () => {
  if (state.tracking) {
    stopTracking();
    return;
  }
  if (!state.trackXY) {
    $('segStatus').textContent = state.strings.ui.trackFirst;
    return;
  }
  state.tracking = true;
  $('btnTrack').textContent = state.strings.ui.stopTrack;
  trackOnce();
  state.trackTimer = setInterval(trackOnce, 2500);
});

/* ---------- mic ---------- */
function encodeWavDataUrl(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

$('btnMic').addEventListener('click', async () => {
  if (state.recording) {
    state.recording.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      state.recording = null;
      $('btnMic').classList.remove('rec');
      try {
        const blob = new Blob(chunks, { type: rec.mimeType });
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await actx.decodeAudioData(await blob.arrayBuffer());
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start();
        const rendered = await offline.startRendering();
        const wavUrl = encodeWavDataUrl(rendered.getChannelData(0), 16000);
        actx.close();
        const res = await api('/transcribe', { sessionId: state.sessionId, audio: wavUrl });
        if (res.stopped) return showStop(res.title, res.message);
        if (res.text) {
          $('msgInput').value = res.text;
          sendMessage(); // mic sends straight into the chat
        }
      } catch (err) {
        aiCard(esc(String(err.message || err).slice(0, 200)));
      }
    };
    state.recording = rec;
    rec.start();
    $('btnMic').classList.add('rec');
    setTimeout(() => {
      if (state.recording === rec) rec.stop();
    }, 15000);
  } catch {
    aiCard(esc(t('speak')));
  }
});

/* ---------- chat flow ---------- */
function showStop(title, message) {
  $('stopTitle').textContent = title || state.strings.stop.title;
  $('stopMessage').textContent = message || state.strings.stop.generic;
  $('btnNew1').textContent = state.strings.ui.newSession;
  show('screen-stop');
}

$('btnNew1').addEventListener('click', () => location.reload());

function progressBar() {
  const done = state.steps.filter((s) => s.verified).length;
  const pct = state.steps.length ? Math.round((100 * done) / state.steps.length) : 0;
  return `<div class="progress"><div class="progressFill" style="width:${pct}%"></div></div>`;
}

function stepsList() {
  return `<ol>${state.steps
    .map((s, i) => {
      const cls = s.verified || i < state.currentStep ? 'done' : i === state.currentStep ? 'current' : '';
      return `<li class="${cls}">${esc(s.text)}</li>`;
    })
    .join('')}</ol>`;
}

function refreshChips() {
  if (state.currentStep < state.steps.length) {
    const label = `${t('checkStep')} (${t('stepOf')} ${state.currentStep + 1})`;
    setChips([{ label, fn: checkCurrentStep }]);
  } else {
    setChips([]);
  }
}

async function sendMessage() {
  const text = $('msgInput').value.trim();
  if (!text || state.busy) return;
  state.busy = true;
  $('msgInput').value = '';
  setChips([]);
  const frame = captureFrame();
  userBubble(text, frame);
  const bubble = aiBubble();
  let streamed = '';
  try {
    const result = await streamApi(
      '/diagnose/stream',
      { sessionId: state.sessionId, transcript: text, image: frame },
      (d) => {
        streamed += d;
        bubble.classList.remove('streaming');
        bubble.textContent = streamed;
        scrollDown();
      },
    );
    bubble.remove();
    if (!result) {
      aiCard(esc(t('thinking')));
    } else if (result.stopped) {
      showStop(result.title, result.message);
    } else if (result.question) {
      const c = aiCard(`${esc(result.question)}${listenButton()}`);
      void c;
    } else if (result.steps) {
      state.steps = result.steps.map((s) => ({ text: s, verified: false }));
      state.currentStep = 0;
      aiCard(
        `<span class="cause">${esc(result.cause || '')}</span>${progressBar()}${stepsList()}${listenButton()}`,
      );
      if (state.strings) speak(`${result.cause || ''}. ${result.steps.join('. ')}`);
      refreshChips();
    } else if (result.error) {
      aiCard(esc(result.message || result.error));
    }
  } catch (err) {
    bubble.remove();
    aiCard(esc(String(err.message || err).slice(0, 300)));
  } finally {
    state.busy = false;
  }
}

$('composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sendMessage();
});

async function checkCurrentStep() {
  if (state.busy) return;
  state.busy = true;
  setChips([]);
  const frame = captureFrame();
  userBubble(`${t('checkStep')} (${t('stepOf')} ${state.currentStep + 1})`, frame);
  const bubble = aiBubble();
  let streamed = '';
  try {
    const result = await streamApi(
      '/verify/stream',
      { sessionId: state.sessionId, image: frame },
      (d) => {
        streamed += d;
        bubble.classList.remove('streaming');
        bubble.textContent = streamed;
        scrollDown();
      },
    );
    bubble.remove();
    if (!result) {
      aiCard(esc(t('thinking')));
    } else if (result.stopped) {
      showStop(result.title, result.message);
    } else if (result.error) {
      aiCard(esc(result.message || result.error));
      refreshChips();
    } else if (result.done && result.status !== 'confirmed' && !result.message) {
      showSummary();
    } else {
      const cls = result.status === 'confirmed' ? 'verdict-ok' : 'verdict-fix';
      const s = await fetch(`/session?id=${state.sessionId}`).then((r) => r.json());
      state.steps = s.steps;
      state.currentStep = s.currentStep;
      aiCard(
        `<span class="${cls}">${esc(result.message || '')}</span>${progressBar()}${stepsList()}${listenButton()}`,
      );
      speak(result.message || '');
      if (result.done || s.done) showSummary();
      else refreshChips();
    }
  } catch (err) {
    bubble.remove();
    aiCard(esc(String(err.message || err).slice(0, 300)));
    refreshChips();
  } finally {
    state.busy = false;
  }
}

async function showSummary() {
  const s = await fetch(`/session?id=${state.sessionId}`).then((r) => r.json());
  const fixed = s.steps.filter((x) => x.verified);
  const open = s.steps.filter((x) => !x.verified);
  const li = (items) => (items.length ? `<ul>${items.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : '');
  aiCard(
    `<span class="cause">${esc(t('summaryTitle'))}</span>` +
      `<br><b>${esc(t('fixed'))}</b>${li(fixed)}` +
      `<b>${esc(t('notFixed'))}</b>${li(open)}` +
      `<br>${esc(t('callPro'))}${listenButton()}`,
  );
  setChips([]);
}

initLang().catch((err) => {
  $('chooseLanguage').textContent = `Failed to load: ${err.message}`;
});
