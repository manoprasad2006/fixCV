/* FixCV frontend: language -> camera/tap -> describe -> steps -> verify -> done.
   Zero dependencies. All user-facing strings come from /locales/*.json.
   New work, 2026-10-28. */
'use strict';

import { decodeRleToRaster } from '/shared/rle.js';

const $ = (id) => document.getElementById(id);
const state = { lang: 'en', strings: null, sessionId: null, frame: null, media: null, recording: null };

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

function show(id) {
  for (const s of ['screen-lang', 'screen-fix', 'screen-steps', 'screen-stop', 'screen-done']) {
    $(s).hidden = s !== id;
  }
}

function t(key) {
  return key.split('.').reduce((o, k) => o?.[k], state.strings?.ui || {}) || key;
}

/* ---- Screen 1: language ---- */
async function initLang() {
  const [en, ta, hi] = await Promise.all([
    fetch('/locales/en.json').then((r) => r.json()),
    fetch('/locales/ta.json').then((r) => r.json()),
    fetch('/locales/hi.json').then((r) => r.json()),
  ]);
  state.disclaimers = { en: en.disclaimer, ta: ta.disclaimer, hi: hi.disclaimer };
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
  $('tapPrompt').textContent = strings.ui.tapPrompt;
  $('describeLabel').textContent = strings.ui.describeLabel;
  $('transcript').placeholder = strings.ui.describePlaceholder;
  $('btnSpeak').textContent = strings.ui.speak;
  $('btnSteps').textContent = strings.ui.getSteps;
  await startCamera();
  show('screen-fix');
}

/* ---- Camera + tap-to-segment ---- */
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

$('overlay').addEventListener('click', async (ev) => {
  const r = ev.target.getBoundingClientRect();
  const x = (ev.clientX - r.left) / r.width;
  const y = (ev.clientY - r.top) / r.height;
  drawTap(ev.clientX - r.left, ev.clientY - r.top);
  state.frame = captureFrame();
  $('segStatus').textContent = '…';
  try {
    const res = await api('/segment', {
      sessionId: state.sessionId,
      image: state.frame,
      x,
      y,
      w: state.frameW,
      h: state.frameH,
    });
    drawMasks(res.masks || []);
    $('segStatus').textContent = `${(res.masks || []).length} region(s)`;
  } catch (err) {
    // The captured frame is still used for diagnosis.
    $('segStatus').textContent = String(err.message || err).slice(0, 160);
  }
});

/* Draw SAM boxes + masks on the overlay canvas. */
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

/* 16-bit PCM mono WAV data URL from Float32 samples. */
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

/* ---- Mic (typed input is the fallback) ---- */
$('btnSpeak').addEventListener('click', async () => {
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
      $('btnSpeak').disabled = false;
      try {
        // Decode whatever the browser recorded, resample to 16 kHz mono,
        // and send WAV — the only encoding verified against the ASR API.
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
        if (res.text) $('transcript').value = res.text;
        if (res.stopped) showStop(res.title, res.message);
      } catch (err) {
        $('fixError').textContent = String(err.message || err).slice(0, 200);
      }
    };
    state.recording = rec;
    rec.start();
    $('btnSpeak').disabled = true;
    setTimeout(() => {
      if (state.recording === rec) rec.stop();
    }, 15000);
  } catch {
    $('fixError').textContent = t('speakUnavailable') === 'speakUnavailable' ? 'mic unavailable' : t('speakUnavailable');
  }
});

/* ---- Diagnose ---- */
$('btnSteps').addEventListener('click', async () => {
  $('fixError').textContent = '';
  $('btnSteps').disabled = true;
  try {
    if (!state.frame) state.frame = captureFrame();
    const res = await api('/diagnose', {
      sessionId: state.sessionId,
      transcript: $('transcript').value.trim(),
      image: state.frame,
    });
    if (res.stopped) return showStop(res.title, res.message);
    $('causeLabel').textContent = state.strings.ui.causeLabel;
    $('verifyTitle').textContent = state.strings.ui.showResult;
    $('btnVerify').textContent = state.strings.ui.verify;
    if (res.question) {
      $('cause').textContent = '';
      $('steps').innerHTML = '';
      $('question').hidden = false;
      $('question').textContent = res.question;
    } else {
      $('cause').textContent = res.cause || '';
      $('question').hidden = true;
      renderSteps(res.steps.map((text) => ({ text, verified: false })), 0);
    }
    show('screen-steps');
  } catch (err) {
    $('fixError').textContent = String(err.message || err).slice(0, 300);
  } finally {
    $('btnSteps').disabled = false;
  }
});

function renderSteps(steps, current) {
  const ol = $('steps');
  ol.innerHTML = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = `${state.strings.ui.stepOf} ${i + 1}: ${s.text}`;
    if (s.verified || i < current) li.className = 'done';
    ol.appendChild(li);
  });
}

/* ---- Verify loop ---- */
$('btnVerify').addEventListener('click', async () => {
  $('stepError').textContent = '';
  $('btnVerify').disabled = true;
  try {
    const res = await api('/verify', { sessionId: state.sessionId, image: captureFrame() });
    if (res.stopped) return showStop(res.title, res.message);
    $('verifyMsg').textContent = res.message || '';
    const s = await fetch(`/session?id=${state.sessionId}`).then((r) => r.json());
    renderSteps(s.steps, s.currentStep);
    if (res.done || s.done) return showSummary(s);
  } catch (err) {
    $('stepError').textContent = String(err.message || err).slice(0, 300);
  } finally {
    $('btnVerify').disabled = false;
  }
});

/* ---- Stop + summary ---- */
function showStop(title, message) {
  $('stopTitle').textContent = title || state.strings.stop.title;
  $('stopMessage').textContent = message || state.strings.stop.generic;
  $('btnNew1').textContent = state.strings.ui.newSession;
  show('screen-stop');
}

function showSummary(s) {
  $('summaryTitle').textContent = state.strings.ui.summaryTitle;
  $('fixedH').textContent = state.strings.ui.fixed;
  $('notFixedH').textContent = state.strings.ui.notFixed;
  $('callPro').textContent = state.strings.ui.callPro;
  $('btnNew2').textContent = state.strings.ui.newSession;
  const fixed = $('fixedList');
  const notFixed = $('notFixedList');
  fixed.innerHTML = '';
  notFixed.innerHTML = '';
  for (const st of s.steps) {
    const li = document.createElement('li');
    li.textContent = st.text;
    (st.verified ? fixed : notFixed).appendChild(li);
  }
  show('screen-done');
}

$('btnNew1').addEventListener('click', () => location.reload());
$('btnNew2').addEventListener('click', () => location.reload());

initLang().catch((err) => {
  $('chooseLanguage').textContent = `Failed to load: ${err.message}`;
});
