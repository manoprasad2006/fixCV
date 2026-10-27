# FixCV

**FixCV: point your camera at anything broken, speak in your own language, and a Meta-powered copilot walks you through the fix and checks each step.**

## The problem

Millions of people fix things at home — a slipping bike chain, a dripping tap, a
jammed drawer — with no repair help in their own language. Manuals are in
English, YouTube videos don't answer back, and a mistranslated step can waste an
afternoon or cause damage. Tenants, recent immigrants, and rural households are
hit hardest: they own the problem but not the vocabulary the internet expects.

Language matters because repair is a conversation, not a document. FixCV lets
the user speak the problem in Tamil, Hindi, or English, and answers back in the
same language — then looks at each finished step and confirms it or corrects it.

## How to run locally

Requirements: Node.js 22+ and one dependency (`@meta-sam/parser`, Meta's
official SAM output parser, zero transitive deps).

1. Clone the repo:
   `git clone https://github.com/manoprasad2006/fixCV.git`
2. Enter it: `cd fixCV`
3. Install: `npm install`
4. Copy the env template: `cp .env.example .env` (Windows: `copy .env.example .env`)
4. Edit `.env` and set `MODEL_API_KEY` to your Meta Model API key from
   dev.meta.ai. Leave `MUSE_SPARK_MODEL` empty to use the verified default
   (`muse-spark-1.3`). `BASETEN_API_KEY` is optional (open-weights bonus path).
5. Start the server: `node backend/server.js`
6. Open `http://localhost:3000` in a phone or laptop browser (camera access
   needs HTTPS or `localhost`).
7. Pick a language, point the camera, tap the faulty part, describe the problem.

Run the checks: `node --test backend/safety.test.js backend/session.test.js`
from the repo root, and `powershell -File scripts/smoke-local.ps1` for the
offline server smoke test.

## Which Meta models are used, and where

| Model | Where in the flow |
|---|---|
| **Muse Spark** (`muse-spark-1.3`, verified live 2026-10-28) | `/diagnose`: cause + numbered steps from frame + transcript + language. `/verify`: confirms or corrects each finished step from a new frame. |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | `/transcribe`: speech-to-text in the session language. Typed input is the fallback. Endpoint verification in progress — see `docs/api-notes.md`. |
| **SAM 3.1** (`sam-3.1`) | `/segment`: segments the tapped region and outlines/tracks it on the canvas overlay. Endpoint verification in progress — see `docs/api-notes.md`. |
| **Muse Spark Open** (Baseten, optional) | Bonus-path reasoning swap once the core loop works. Needs `BASETEN_API_KEY`. |
| **Muse Image** (optional) | "How it should look" reference overlay. Lowest priority. |

Every model ID, endpoint, and response shape in `docs/api-notes.md` comes from
a real test call — nothing is invented. Where docs and test calls disagreed,
the test call won.

## Built during the hackathon

Solo entry for the Meta Global AI Developer Hackathon, Indie Developer track.
All work below is original, created Oct 27 – Nov 4, 2026, in this repo's commit
history. No code, prompts, or assets were reused from older projects.

- **2026-10-28**: repo init, `.gitignore`, `.env.example`
  (`de94655`)
- **2026-10-28**: live API verification of Muse Spark 1.3/1.2/1.1;
  `docs/api-notes.md` (`826c598`)
- **2026-10-28**: Node backend — session store, trilingual safety gate,
  `/diagnose` + `/verify` via Spark, prompts, `en`/`ta`/`hi` locales
  (`9725cf9`)
- **2026-10-28**: single-page frontend — camera + tap overlay, mic with typed
  fallback, step cards, stop screen, summary; offline smoke test (`2338e9b`)
- **2026-10-28**: README + demo shot list (`2dbf2ee`); ASR endpoint verified
  and live `/transcribe` with in-browser 16 kHz WAV; live E2E green
  (`7a262b3`, `a28847b`, `cecd626`)
- **2026-10-28**: SAM 3.1 verified via Responses API; live `/segment` with
  point prompts; box + RLE mask canvas overlay; Spark empty-reply retry
  (`16152fa`)

## Safety rules

FixCV refuses to give repair steps for these cases and shows a full stop screen
in the user's language instead:

- Gas (including LPG/CNG, cylinders, gas smell)
- Mains electricity (exposed wiring, switchboards, shocks)
- Fuel systems (petrol, diesel, fuel leaks)
- Structural load (load-bearing walls, beams, foundations, major cracks)
- Vehicle brakes (never ride or drive — see a mechanic)
- Anything medical (FixCV is a home-repair copilot only)

The gate runs on user input **before** every model call and **again** on every
model output. If the model is unsure of the cause, it asks one clarifying
question instead of guessing (confidence gate).

> **Disclaimer:** Guidance only. Stop and call a professional if unsure or if
> there's any danger.

## Languages

English (`en`), Tamil (`ta`), Hindi (`hi`). All UI strings live in
`locales/*.json`; the session language is picked once on the first screen and
never switched mid-sentence.

> **Note:** Tamil and Hindi strings are machine-generated and **pending
> native-speaker review** (`"reviewed": false` in `locales/ta.json` and
> `locales/hi.json`). Do not treat the safety text as final until a native
> speaker confirms it.

## Demo

- Demo video (under 3 minutes, original footage): **TODO — builder to add link**
- Live demo: **TODO — builder to add link**
- Shot list: `demo/demo_script.md`
