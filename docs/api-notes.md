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

Round 2 (builder-run, 2026-10-28, `scripts/probe-round2.mjs`):

- Text-only, `max_tokens: 300`: 200, `finish_reason: stop`,
  `content: "PROBE_OK"`, `reasoning_tokens: 122` of 134 completion tokens.
  Positive-content output CONFIRMED.
- With 1px image, `max_tokens: 300`: 200 but `finish_reason: length`,
  `content: null`, `reasoning_tokens: 298` of 300. Image inputs trigger much
  heavier reasoning; 300 tokens is not enough.
- Consequence: integration default raised to `max_tokens: 2000`
  (`backend/meta.js`). Re-verify content delivery on a real diagnose call.

## 4. Muse Voice Transcribe (NOT YET VERIFIED — probe ready)

- Model ID `muse-voice-transcribe-1.0` appears in `/models` (so the ID is real).
- Candidate endpoints (third-party only, UNCONFIRMED):
  - File: `POST https://api.meta.ai/v1/asr/transcribe`
  - Realtime: `wss://api.meta.ai/v1/asr/realtime`
- Round 2 result: `POST /asr/transcribe` with multipart (`model`, `language`,
  `file`) returns **400**: `"Both a 'request' and an 'audio' part are
  required"`. The endpoint EXISTS; the part names were wrong.
- Round 3 (`scripts/probe-round3.mjs`, RUN): `request`+`audio` parts with
  `{model?, language?}` return **400**: `"You must specify the
  'audioEncoding' field"` (param `audioEncoding`). Realtime WebSocket
  `wss://api.meta.ai/v1/asr/realtime` handshake: **OPEN ok** with Bearer auth.
- Round 4 (`scripts/probe-round4.mjs`, RUN): `audioEncoding: LINEAR16`
  (+ rate) returns **400** `"Malformed request"`. `audioEncoding: WAV`
  without `model` returns **400** `"You must specify the 'model' field"`.
- Round 5 (`scripts/probe-round5.mjs`, RUN): **VERIFIED, 200**.
  Request: multipart `request` =
  `{"model":"muse-voice-transcribe-1.0","language":"en","audioEncoding":"WAV","sampleRateHertz":16000}`
  + `audio` = 16 kHz mono WAV bytes.
  Response: `{"sessionId":"voyager/transcribe/...","transcript":"","audioDurationMs":1040,"turns":[]}`
  (empty transcript expected — the probe clip is a tone, not speech).
- Integration (`/transcribe`): forwards 16 kHz WAV + session language.
  Frontend resamples mic audio to 16 kHz WAV in-browser (`encodeWavDataUrl`).
- Still required: transcription of real speech in English, Tamil, Hindi
  (needs voice clips the agent cannot record — builder to test via the app).
- Still required by the brief: transcription tests with English, Tamil, and
  Hindi clips. Builder to provide or record clips; agent to run once available.

## 5. SAM 3.1 segmentation/tracking (VERIFIED, 200)

Official docs found at `https://ai.developer.meta.com/docs/sam/*`
(overview, segmenting, reading-segmentation, client-libraries). Third-party
conflict resolved in favor of learnopencv: SAM 3.1 IS hosted on the API.

- Endpoint: `POST https://api.meta.ai/v1/responses` (Responses API, SSE
  stream), `model: "sam-3.1"`. One call carries prompt + media; the stream
  returns one `response.output_text.delta` line per frame (special-token
  text: `<Nf>id<|box;...|><|mask;...|>`), ending with `response.completed`.
  Empty `output_text` = zero matches (normal, not an error).
- Image input: `input_image` part, `image_url` = public URL or base64 data URL.
  Video input: `input_video` part (`video_url` or Files-API `file_id`) — SAM
  tracks prompted objects across frames (`propagation_direction` metadata).
  FixCV uses per-tap/per-step stills (the brief's allowed fallback); clip
  tracking is not wired.
- Point prompts (verified): `input_text` =
  `<0f>1<|point;x=160;y=120;w=320;h=240|>` built by `buildObjectPrompt`
  from `@meta-sam/parser` (official, zero-dep, npm). Concept prompts (short
  noun phrase) also work. Never both in one call. Max 16 prompted objects.
- Masks: base85 payload, `~` lossless default; decoded with the parser's
  `decodeMaskToRLE` into COCO RLE (`{size:[h,w],counts}`, column-major).
  `metadata.mask_encoding: "one_bit"` and `include_confidence: "true"`
  available but not used.
- Live test (`scripts/sam-probe.mjs`, RUN): synthetic 320x240 PNG, red square
  at (80,60)-(240,180). Concept "red square" -> box exactly 80,60,240,180,
  mask 19196/19200 ones. Point at (160,120) -> box 80,60,241,180, mask sane.
- Integration (`/segment`): tap x/y (0..1) + frame w/h -> pixel point prompt
  -> `{masks:[{id, box, rle, frame}]}`. Frontend draws box + RLE mask on the
  overlay canvas (`shared/rle.js`, tested in `backend/sam.test.js`).

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
  upload. RUN (builder-run 2026-10-28).
- `scripts/probe-round3.mjs` — ASR `request`+`audio` part combos + realtime WS
  handshake. RUN.
- `scripts/probe-round4.mjs` — ASR `audioEncoding` variants. RUN.
- `scripts/probe-round5.mjs` — ASR WAV+model shape. RUN, 200 VERIFIED.
- `scripts/sam-probe.mjs` — SAM concept + point prompts on synthetic PNG.
  RUN, boxes and masks VERIFIED.
- `scripts/probe-tone.wav` — generated by probe-round2 at run time (16 kHz tone,
  not committed).
