// Shared FixCV live-session helpers (Node + browser): pure logic for the
// tap-to-talk loop — voice activity, silence stop, frame sampling.
// New work, 2026-11-03.

/** RMS energy of Float32 time-domain samples (0..1-ish). */
export function rmsEnergy(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** True when frame energy counts as speech. */
export function isSpeech(rms, threshold = 0.02) {
  return rms >= threshold;
}

/**
 * Silence-stop decision for tap-to-talk.
 * @param {number} silentMs continuous ms below threshold
 * @param {number} elapsedMs total recorded ms
 * @param {{silenceMs:number,minMs:number}} opts
 */
export function shouldStopTalking(silentMs, elapsedMs, opts = {}) {
  const { silenceMs = 1200, minMs = 1000 } = opts;
  return elapsedMs >= minMs && silentMs >= silenceMs;
}

/**
 * Frame-sampling decision for live context.
 * @param {number} nowMs clock
 * @param {number} lastSentMs last sampled frame, or -Infinity
 * @param {number} intervalMs throttle
 */
export function shouldSampleFrame(nowMs, lastSentMs, intervalMs = 4000) {
  return nowMs - lastSentMs >= intervalMs;
}
