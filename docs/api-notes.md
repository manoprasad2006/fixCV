# FixCV API notes (verification-first log)

Rule: nothing here is invented. Each entry records the working model ID,
request format, and response observed in a real test call. Where docs and
test calls disagree, the test call wins and the difference is noted.

Date: 2026-10-28 (all calls made during the building window).
Key: `MODEL_API_KEY` (48 chars, present). Key value never recorded.

## 1. Meta Model API — base + auth (VERIFIED)

- Base URL: `https://api.meta.ai/v1`
- Auth: `Authorization: Bearer <MODEL_API_KEY>`
- Style: OpenAI-compatible (`/models`, `/chat/completions` behave as documented
  by third-party SDK guides; official docs at https://ai.developer.meta.com/docs/models/
  were not directly fetched — sandbox blocks unauthenticated browsing, and the
  live API responses below are authoritative).

## 2. GET /models (VERIFIED, 200)

Request: `GET https://api.meta.ai/v1/models` with Bearer auth.

Response `data[].id` values observed:

- `muse-spark-1.3`
- `muse-spark-1.3-contributor`
- `muse-spark-1.2`
- `muse-spark-1.2-contributor`
- `muse-spark-1.1`
- `muse-voice-transcribe-1.0`
- `sam-3.1`
- `muse-image-1.0`
- `muse-wonder-1.0` (unexpected; not in the brief — unused by FixCV)

Difference from brief: the brief listed 1.1/1.2/1.2-contributor as confirmed
and 1.3 as unconfirmed third-party. The live API confirms `muse-spark-1.3`
(plus `muse-spark-1.3-contributor`) exists. `sam-3.1` and
`muse-voice-transcribe-1.0` are listed as model IDs, but this listing does
NOT reveal their HTTP endpoint paths (see sections 4 and 5).

## 3. POST /chat/completions with Muse Spark (VERIFIED, 200)

Tested `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1`.
Request shape (OpenAI-compatible, image as data-URL `image_url`):

```json
{
  "model": "muse-spark-1.3",
  "max_tokens": 60,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Reply with exactly: PROBE_OK" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
      ]
    }
  ]
}
```

Observed response (all three IDs, status 200):

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "muse-spark-1.3",
  "choices": [
    {
      "index": 0,
      "finish_reason": "length",
      "message": { "role": "assistant", "content": null, "refusal": null }
    }
  ],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 60,
    "total_tokens": 78,
    "completion_tokens_details": { "reasoning_tokens": 58 }
  }
}
```

Findings:

- All three Spark IDs accept the request, including the `image_url` part
  (no multimodal rejection error). Image *understanding* still needs one
  positive-content confirmation run.
- Spark reasons first: with `max_tokens: 60`, all 60 completion tokens went
  to hidden reasoning (`reasoning_tokens: 58`) and `content` came back null
  with `finish_reason: length`. Integration MUST budget generous
  `max_tokens` (start at 800–1500 for diagnose/verify) or replies will be empty.
- Decision: use `muse-spark-1.3` as `MUSE_SPARK_MODEL` (newest, verified live).
  Fallback order: 1.2, then 1.1.

## 4. Muse Voice Transcribe (NOT YET VERIFIED — probe ready)

- Model ID `muse-voice-transcribe-1.0` appears in `/models` (so the ID is real).
- Candidate endpoints (third-party only, UNCONFIRMED):
  - File: `POST https://api.meta.ai/v1/asr/transcribe`
  - Realtime: `wss://api.meta.ai/v1/asr/realtime`
- Probe script `scripts/probe-round2.mjs` (step `asr-file`) uploads a generated
  16 kHz mono WAV via multipart form (`model`, `language`, `file` fields) and
  prints status + body. NOT RUN YET — needs one network-approved shell run.
- Still required by the brief: transcription tests with English, Tamil, and
  Hindi clips. Builder to provide or record clips; agent to run once available.

## 5. SAM 3.1 segmentation/tracking (NOT YET VERIFIED — endpoint unknown)

- Model ID `sam-3.1` appears in `/models` (so the ID is real).
- No endpoint path found in docs search. Third-party coverage conflicts:
  - learnopencv (Sep 18, 2026): SAM 3.1 available through Meta Model API
    (hosted route, no self-serving needed).
  - developersdigest: "No hosted inference endpoint; run it yourself."
- Next steps, in order:
  1. Run `scripts/probe-round2.mjs` steps `meta-sam` / `meta-asr`
     (`GET /models/sam-3.1`, `GET /models/muse-voice-transcribe-1.0`) — the
     metadata responses may name the inference paths.
  2. Builder asks Discord `#office-hours` for the official SAM 3.1 endpoint,
     input format, and whether video tracking is supported.
  3. If no hosted endpoint exists: per the brief, STOP the /segment-via-API
     step and report to the builder (fallback would be per-step re-segmentation
     via whatever route Meta supports, or local weights — builder decision).
- Do NOT build `/segment` against a guessed path.

## 6. Baseten open-weights path (BLOCKED — no key)

- `BASETEN_API_KEY` is empty (builder has not created it yet).
- Nothing tested. When the key exists, test in this order:
  1. `meta-models/muse-spark-open-1026` (hackathon ID) via
     `POST https://inference.baseten.co/v1/chat/completions`, OpenAI-compatible.
  2. If it fails, `meta-models/muse-spark-open` (changelog ID) and tell the builder.
- This is step 9 (optional, lowest priority). Not blocking the Meta path.

## 7. Muse Image (NOT TESTED — lowest priority)

- `muse-image-1.0` appears in `/models`. No test call made yet.
- Step 9 optional. Likely path `/images/generations` (third-party only — verify
  with one call before integrating).

## Probe scripts (all new work, committed)

- `scripts/probe-models.mjs` — `/models` list + Spark 1.3/1.2/1.1 image calls. RUN.
- `scripts/probe-round2.mjs` — Spark content output, model metadata, ASR file
  upload. WRITTEN, NOT RUN (needs network-approved shell).
- `scripts/probe-tone.wav` — generated by probe-round2 at run time (16 kHz tone,
  not committed).
