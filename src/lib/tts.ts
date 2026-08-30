import "server-only";
import { env } from "./env";

/**
 * Chatterbox TTS, hosted as a Gradio Space on Hugging Face ZeroGPU.
 *
 * ZeroGPU only supports the Gradio SDK, so this is not a plain REST call --
 * Gradio's HTTP API is two-phase: POST the inputs to receive an event id, then
 * read the result off an SSE stream. The Space pulls the reference voice
 * straight from the presigned storage URL we hand it, so we never upload the
 * clip ourselves.
 */

const ENDPOINT = "generate_tts_audio";
const DEFAULT_TIMEOUT_MS = 180_000;

/** `owner/Space-Name` -> `https://owner-space-name.hf.space` */
function spaceOrigin(spaceId: string): string {
  const host = spaceId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `https://${host}.hf.space`;
}

function authHeaders(): Record<string, string> {
  // Authenticating attributes GPU time to our own daily quota rather than the
  // much smaller anonymous one.
  return { Authorization: `Bearer ${env.HF_TOKEN}` };
}

type GradioFileData = {
  path: string;
  url: string;
  orig_name: string;
  mime_type: string;
  meta: { _type: "gradio.FileData" };
};

function asFileData(url: string): GradioFileData {
  return {
    path: url,
    url,
    orig_name: "reference.wav",
    mime_type: "audio/wav",
    meta: { _type: "gradio.FileData" },
  };
}

/** Pull the payload of the terminal SSE event out of a Gradio result stream. */
function parseEventStream(body: string): unknown {
  let completed: unknown;

  for (const frame of body.split("\n\n")) {
    const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = frame.match(/^data:\s*([\s\S]+?)$/m)?.[1]?.trim();
    if (!event || !data) continue;

    if (event === "error") {
      throw new Error(`Space returned an error: ${data.slice(0, 300)}`);
    }
    if (event === "complete") {
      completed = JSON.parse(data);
    }
  }

  if (completed === undefined) {
    throw new Error("Space stream ended without completing");
  }
  return completed;
}

export type GenerateSpeechOptions = {
  text: string;
  /** Presigned URL of the reference voice clip. */
  voiceUrl: string;
  temperature: number;
  exaggeration: number;
  cfgWeight: number;
  seed?: number;
  signal?: AbortSignal;
};

export async function generateSpeech({
  text,
  voiceUrl,
  temperature,
  exaggeration,
  cfgWeight,
  seed = 0,
  signal,
}: GenerateSpeechOptions): Promise<Buffer> {
  const origin = spaceOrigin(env.HF_SPACE_ID);
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // Argument order matches the Space's declared parameters.
  const payload = {
    data: [
      text,
      asFileData(voiceUrl),
      exaggeration,
      temperature,
      seed,
      cfgWeight,
      false, // vad_trim_input
    ],
  };

  const queued = await fetch(`${origin}/gradio_api/call/${ENDPOINT}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: abort,
  });

  if (!queued.ok) {
    throw new Error(
      `Failed to queue generation (${queued.status} ${queued.statusText})`,
    );
  }

  const { event_id: eventId } = (await queued.json()) as { event_id?: string };
  if (!eventId) {
    throw new Error("Space did not return an event id");
  }

  const stream = await fetch(
    `${origin}/gradio_api/call/${ENDPOINT}/${eventId}`,
    { headers: authHeaders(), signal: abort },
  );

  if (!stream.ok) {
    throw new Error(
      `Failed to read generation result (${stream.status} ${stream.statusText})`,
    );
  }

  const result = parseEventStream(await stream.text());
  const file = Array.isArray(result) ? result[0] : result;
  const audioUrl = (file as { url?: string } | null)?.url;

  if (!audioUrl) {
    throw new Error("Space completed without returning audio");
  }

  const audio = await fetch(audioUrl, { headers: authHeaders(), signal: abort });
  if (!audio.ok) {
    throw new Error(`Failed to download audio (${audio.status})`);
  }

  return Buffer.from(await audio.arrayBuffer());
};
