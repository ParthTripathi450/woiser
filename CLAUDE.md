# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Next.js dev server on :3000
npm run build            # production build (also the only typecheck)
npm run lint             # eslint (flat config)

npx prisma migrate dev --name <name>   # create + apply a migration
npx prisma migrate deploy              # apply migrations
npx prisma generate                    # regenerate client into src/generated/prisma (runs on postinstall)
npx prisma db seed                     # scripts/seed-system-voices.ts -> 20 system voices into DB + storage
```

No test suite exists. Verification is `npm run lint` + `npm run build`.

`SKIP_ENV_VALIDATION=1` bypasses the schema in `src/lib/env.ts`. Prefer leaving it empty so the
build actually validates config.

To run a script against the real server modules, `server-only` must resolve:
`NODE_OPTIONS="--conditions=react-server" npx tsx script.ts`. Note that `tsx` runs `.ts` as CJS
here, so a scratch script cannot use top-level await — wrap it in `main()`.

## This is a card-free fork

Upstream Resonance uses Cloudflare R2 and Modal. **Both require a payment method, which this
project does not have.** They were replaced with card-free equivalents. Keep that invariant:
when adding anything that touches a vendor, gate it and default it off.

| Concern | Upstream | Here |
|---|---|---|
| Storage | Cloudflare R2 | **Supabase Storage** over its S3-compatible API |
| TTS | Modal GPU + FastAPI | **Hugging Face Space** running Chatterbox on ZeroGPU |
| Billing | Polar, mandatory | Polar behind `BILLING_ENABLED`, currently **off** |
| Errors | Sentry, hardcoded DSN | Sentry only when `SENTRY_DSN` is set |

## Architecture

Next.js 16 App Router + React 19 + tRPC 11 + Prisma 7, with Clerk for auth, Supabase for audio
storage, and a Hugging Face Space for inference.

### Multi-tenancy: `orgId` is the tenancy key

Not `userId`. `src/proxy.ts` (Next 16's renamed `middleware.ts`) protects every non-auth route and
redirects signed-in users without an active org to `/org-selection` — so Clerk **Organizations must
stay enabled**. `orgProcedure` in `src/trpc/init.ts` supplies `{ userId, orgId }`, and every Prisma
query filters on `orgId`. Any new query touching `Voice` or `Generation` must scope by `ctx.orgId`.
`Voice` splits on `variant`: `SYSTEM` voices are global (`orgId: null`), `CUSTOM` voices are org-owned.

Because tenancy is centralised in one procedure, switching to personal accounts would be a small
change in `init.ts` + `proxy.ts` rather than a sweep.

### Audio never leaves storage by public URL

`objectKey` is deliberately `omit`ted from tRPC payloads. Clients get relative proxy URLs:
`/api/audio/[generationId]` and `/api/voices/[voiceId]`. Those handlers re-check Clerk auth and org
ownership, presign a URL via `getSignedAudioUrl`, fetch it server-side, and stream the body back.
The Supabase bucket is private and must stay that way.

### Storage is one file

`src/lib/storage.ts` holds the entire S3 surface (`uploadAudio`, `deleteAudio`, `getSignedAudioUrl`).
Supabase needs `forcePathStyle: true` and an endpoint ending `/storage/v1/s3`; everything else is
stock AWS SDK. `scripts/seed-system-voices.ts` builds its own client and must be changed in step.
The five consumer files never see the vendor.

### TTS: Gradio, not REST

`src/lib/tts.ts` talks to the Space. ZeroGPU **only supports the Gradio SDK**, so this is not a
plain REST call — Gradio's API is two-phase: POST inputs to `/gradio_api/call/generate_tts_audio`
to get an `event_id`, then read the result off an SSE stream and download the returned file.

The Space pulls the reference voice **directly from a presigned Supabase URL** we pass as
`gradio.FileData`, so we never upload the clip ourselves. The argument order in the `data` array is
positional and must match the Space's declared parameters:
`[text, referenceFile, exaggeration, temperature, seed, cfgWeight, vadTrim]`.

Real operating limits, which drive several design choices:
- **5 minutes of GPU per day** on a free HF account.
- **60s default cap** per call (raisable via `@spaces.GPU(duration=)` in the Space).
- `TEXT_MAX_LENGTH` is **300**, matching the cap inside the Space's `app.py`. Raising it here
  requires raising it there too, and burns quota faster.
- The Space sleeps; the first call after idle is slow.

### Generation parameters

Chatterbox exposes different knobs than upstream's Modal build. `topP`/`topK`/`repetitionPenalty`
are gone; the model takes `temperature`, `exaggeration` and `cfgWeight`. The three UI sliders in
`src/features/text-to-speech/data/sliders.ts` map onto exactly those, and the `Generation` table
stores them.

### Two-phase create + rollback

`generations.create` and `POST /api/voices/create` both derive the storage key from the DB id:

1. create the row without `objectKey`
2. upload to `<generations|voices>/orgs/<orgId>/<id>`
3. update the row with `objectKey`
4. on failure, delete the orphan row and throw

Voice creation is a REST route rather than tRPC because it takes a raw binary body (tRPC cannot);
it re-implements auth by hand, caps uploads at 20 MB to match `proxyClientMaxBodySize`, and rejects
clips under 10s via `music-metadata`.

### Billing is gated

`src/lib/billing.ts` is the only entry point. With `BILLING_ENABLED=false`, `hasActiveSubscription`
returns true, `recordUsage` is a no-op, `getBillingStatus` reports an unmetered org, and
`UsageContainer` renders nothing. `src/lib/polar.ts` exports `null` in that state, so the SDK stays
dormant. The disabled path is a real no-op, never a stubbed error.

### Feature-folder + prefetch/hydrate convention

`src/features/<feature>/{components,views,hooks,contexts,data,lib}`. Route files stay thin: parse
`searchParams`, `prefetch(trpc.x.queryOptions(args))`, wrap in `<HydrateClient>`. The matching view
is `"use client"` and reads the same data with `useSuspenseQuery`. **Prefetch args must match the
client args exactly** or hydration misses and it refetches — see the voices page, where the server
parses `query` via `voicesSearchParamsCache` and the client reads it via `useQueryState` (nuqs).

### Conventions

- Prisma client generates to `src/generated/prisma`, **not** `node_modules` — import from
  `@/generated/prisma/client`. Gitignored, so `prisma generate` must run on a fresh clone.
- Anything importing `@/lib/env` is server-only and will fail validation in a client bundle.
- UI is shadcn/ui "new-york", neutral, Tailwind v4 (no config file — theme is in
  `src/app/globals.css`). Treat `src/components/ui/*` as vendored.
- Forms use TanStack React Form via `useAppForm` with Zod schemas, re-declared server-side as the
  tRPC input.
- Storage budget is 500 MB. The 20 system voices take 30 MB; generated WAVs run ~2.9 MB/minute.
- Supabase pauses free projects after 7 days idle, and the Prisma Postgres instance sleeps —
  a first connection can fail `P1001` and succeed on retry.
