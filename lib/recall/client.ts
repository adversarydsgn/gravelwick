const RECALL_API_BASE = 'https://api.recall.ai/api/v1';

function recallHeaders() {
  return {
    'Authorization': `Token ${process.env.RECALL_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function scheduleBot(params: {
  meetingUrl: string;
  joinAt: string; // ISO 8601
}) {
  const res = await fetch(`${RECALL_API_BASE}/bot/`, {
    method: 'POST',
    headers: recallHeaders(),
    body: JSON.stringify({
      meeting_url: params.meetingUrl,
      bot_name: 'Watson',
      recording_config: { video: true, audio: true },
      join_at: params.joinAt,
      automatic_leave: {
        waiting_room_timeout: 600,
        noone_joined_timeout: 600,
      },
      output_media: {
        camera: {
          kind: 'jpeg_image',
          config: { width: 1280, height: 720 },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Recall.ai scheduleBot failed: ${res.status} ${err}`);
  }

  return res.json() as Promise<{ id: string }>;
}

export async function getBotRecording(botId: string) {
  const res = await fetch(`${RECALL_API_BASE}/bot/${botId}/`, {
    headers: recallHeaders(),
  });

  if (!res.ok) throw new Error(`Recall.ai getBotRecording failed: ${res.status}`);
  return res.json();
}

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // Recall.ai uses HMAC-SHA256 signatures
  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}
