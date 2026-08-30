import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

// Supabase Storage exposes an S3-compatible endpoint, so the standard AWS SDK
// works unchanged. It requires path-style addressing.
const s3 = new S3Client({
  region: env.SUPABASE_S3_REGION,
  endpoint: env.SUPABASE_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY,
  },
});

type UploadAudioOptions = {
  buffer: Buffer;
  key: string;
  contentType?: string;
};

export async function uploadAudio({
  buffer,
  key,
  contentType = "audio/wav",
}: UploadAudioOptions): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
};

export async function deleteAudio(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: key,
    }),
  );
};

export async function getSignedAudioUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.STORAGE_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
};
