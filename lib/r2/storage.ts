import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export function buildR2Key(meetingId: string, date: Date, filename: string): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `recordings/${yyyy}/${mm}/${dd}/${meetingId}/${filename}`;
}

export async function uploadToR2(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    })
  );
}

export async function uploadJsonToR2(key: string, data: unknown): Promise<void> {
  await uploadToR2({
    key,
    body: Buffer.from(JSON.stringify(data, null, 2)),
    contentType: 'application/json',
  });
}

export async function generatePresignedUrl(key: string, expiresInSeconds = 86400): Promise<string> {
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

export async function downloadFromUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download from ${url}: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
