<div align="center">

<h1>Resonance</h1>

<p>Open-source text-to-speech and voice cloning, running entirely on free infrastructure.</p>

<p>Next.js 16 · React 19 · tRPC · Prisma · Chatterbox TTS on Hugging Face ZeroGPU</p>

</div>

---

## About this fork

This is a fork of [code-with-antonio/resonance](https://github.com/code-with-antonio/resonance),
reworked so it can be run **without a payment method of any kind**.

Upstream depends on Cloudflare R2 for storage and Modal for GPU inference. Both require a card on
file, even on their free tiers. This fork replaces them and gates everything else:

| Concern | Upstream | This fork | Card needed |
|---|---|---|---|
| Audio storage | Cloudflare R2 | **Supabase Storage** (S3-compatible API) | No |
| TTS inference | Modal (A10G + FastAPI) | **Hugging Face Space** (Chatterbox on ZeroGPU) | No |
| Database | Prisma Postgres | Prisma Postgres | No |
| Auth | Clerk | Clerk | No |
| Billing | Polar, required | Polar behind `BILLING_ENABLED`, **off by default** | No |
| Errors | Sentry, hardcoded DSN | Sentry only if `SENTRY_DSN` is set | No |

Everything below reflects this fork. Upstream's setup instructions do not apply.

## Features

- **Text-to-speech** with adjustable creativity, expression range and flow
- **Zero-shot voice cloning** — upload or record a 10s+ sample, no fine-tuning
- **20 built-in voices** across 12 categories and 5 locales
- **Waveform player** (WaveSurfer.js) with seek, play/pause and download
- **Multi-tenant** — team-based access and data isolation via Clerk Organizations
- **Generation history** with preserved voice metadata
- **Responsive** — mobile drawers, adaptive layouts

## How it fits together

Audio is never exposed by public URL. The Supabase bucket stays private; the app serves audio
through its own authenticated proxy routes (`/api/audio/[id]`, `/api/voices/[id]`), which re-check
Clerk auth and org ownership, presign a short-lived URL, and stream the bytes back.

For generation, the app hands the Space a **presigned URL for the reference clip** rather than
uploading it — the Space fetches the voice itself, so a generation is a single round trip.

ZeroGPU only supports the Gradio SDK, so `src/lib/tts.ts` speaks Gradio's two-phase protocol: POST
the inputs to receive an event id, then read the result off an SSE stream.

## Setup

### Prerequisites

- Node.js 20.9+
- A [Prisma Postgres](https://www.prisma.io/postgres) database (free, no card)
- A [Clerk](https://clerk.com) account with **Organizations enabled** (free, no card)
- A [Supabase](https://supabase.com) project (free, no card)
- A [Hugging Face](https://huggingface.co) account **older than 30 days** with a verified email —
  this is what unlocks hosting a ZeroGPU Space (free, no card)

### 1. Install

```bash
git clone <your-fork-url>
cd resonance
npm install
cp .env.example .env
```

### 2. Storage — Supabase

Create a project, then **Storage → New bucket**. Keep it **private**.

Under **Project Settings → Storage** collect the S3 endpoint and region, then generate an S3 access
key pair. Fill in `STORAGE_BUCKET`, `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`,
`SUPABASE_S3_ACCESS_KEY_ID` and `SUPABASE_S3_SECRET_ACCESS_KEY`.

> Supabase only supplies storage here. The database is Prisma Postgres.

### 3. TTS — Hugging Face Space

Duplicate [ResembleAI/Chatterbox](https://huggingface.co/spaces/ResembleAI/Chatterbox) and select
**ZeroGPU** hardware. Create a **Read** token under
[Access Tokens](https://huggingface.co/settings/tokens).

Set `HF_SPACE_ID` (e.g. `your-username/Chatterbox`) and `HF_TOKEN`.

### 4. Auth — Clerk

Enable **Organizations** in the Clerk dashboard. Without it every protected route redirects to
`/org-selection` forever. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.

### 5. Database

```bash
npx prisma migrate deploy
npx prisma db seed        # 20 system voices into Postgres + Supabase (~30 MB)
```

### 6. Run

```bash
npm run dev
```

## Deploying

Deploy to [Vercel](https://vercel.com) — the Hobby tier is free with no card, and covers this app.

1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. Add every variable from your `.env` to the project's environment variables, setting `APP_URL` to
   the deployed URL. Leave `SKIP_ENV_VALIDATION` empty so the build validates config.
3. Deploy. `postinstall` runs `prisma generate`, which is required because the client is gitignored.

Notes:
- Clerk **development** keys work on a `*.vercel.app` domain. A Clerk production instance needs a
  domain you own, so keep the dev keys until you have one.
- Generation is long-running. Keep **Fluid compute** enabled (the default) — it raises the Hobby
  function ceiling from 60s to 300s.
- Vercel's Hobby tier is for personal, non-commercial projects.

## Limits worth knowing

These come from the free tiers and shape the app's defaults:

| Limit | Value | Consequence |
|---|---|---|
| ZeroGPU quota | 5 min GPU/day (free HF account) | ~40–60 generations/day |
| ZeroGPU call cap | 60s default | `TEXT_MAX_LENGTH` is **300**, matching the Space |
| ZeroGPU hosting | 2 Spaces per free account | Account must be >30 days old, email verified |
| Supabase storage | 500 MB | System voices take 30 MB; output runs ~2.9 MB/min |
| Supabase idle | Pauses after 7 days | Unpause from the dashboard |
| Prisma Postgres | Sleeps when idle | A first request may fail `P1001`, then succeed |

Raising `TEXT_MAX_LENGTH` means raising the cap inside the Space's `app.py` too, and it burns GPU
quota proportionally.

## Generation parameters

Chatterbox exposes different knobs than upstream's Modal build, so the sliders map to the model's
actual controls:

| Slider | Parameter |
|---|---|
| Creativity | `temperature` |
| Expression Range | `exaggeration` |
| Natural Flow | `cfg_weight` |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (also the only typecheck) |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |

There is no test suite; verification is `npm run lint` plus `npm run build`.

## Acknowledgements

- [Resonance](https://github.com/code-with-antonio/resonance) by Code With Antonio — the original project
- [Chatterbox TTS](https://github.com/resemble-ai/chatterbox) by Resemble AI — the model
- [Modal's voice sample pack](https://modal-cdn.com/blog/audio/chatterbox-tts-voices.zip) — the 20 system voices
