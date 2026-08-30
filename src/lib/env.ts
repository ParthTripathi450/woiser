import { z } from "zod";
import { createEnv } from "@t3-oss/env-nextjs";

const boolish = z
  .string()
  .default("false")
  .transform((value) => value.trim().toLowerCase() === "true");

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    APP_URL: z.string().min(1),

    // Object storage. Supabase Storage speaks the S3 protocol, so this is an
    // ordinary SigV4 S3 target -- see src/lib/storage.ts.
    STORAGE_BUCKET: z.string().min(1),
    SUPABASE_S3_ENDPOINT: z.url(),
    SUPABASE_S3_REGION: z.string().min(1),
    SUPABASE_S3_ACCESS_KEY_ID: z.string().min(1),
    SUPABASE_S3_SECRET_ACCESS_KEY: z.string().min(1),

    // Text-to-speech. A Hugging Face Space running Chatterbox on ZeroGPU.
    HF_SPACE_ID: z.string().min(1),
    HF_TOKEN: z.string().min(1),

    // Billing is opt-in. Everything Polar-related is only required when it is on.
    BILLING_ENABLED: boolish,
    POLAR_ACCESS_TOKEN: z.string().optional(),
    POLAR_PRODUCT_ID: z.string().optional(),
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
    POLAR_METER_VOICE_CREATION: z.string().default("voice_creation"),
    POLAR_METER_TTS_GENERATION: z.string().default("tts_generation"),
    POLAR_METER_TTS_PROPERTY: z.string().default("characters"),

    // Error monitoring is off unless a DSN is supplied.
    SENTRY_DSN: z.string().optional(),
  },
  experimental__runtimeEnv: {},
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
