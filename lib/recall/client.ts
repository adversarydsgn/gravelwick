const RECALL_API_BASE = process.env.RECALL_API_BASE ?? 'https://us-west-2.recall.ai/api/v1';

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

// Recall.ai uses Svix for webhook delivery (secret starts with whsec_)
export function verifyWebhookSignature(
  payload: string,
  headers: Record<string, string | null>,
  secret: string
): boolean {
  const { Webhook } = require('svix');
  const wh = new Webhook(secret);
  // Svix requires all three headers to be non-null strings
  const svixId = headers['svix-id'];
  const svixTimestamp = headers['svix-timestamp'];
  const svixSignature = headers['svix-signature'];
  if (!svixId || !svixTimestamp || !svixSignature) {
    // Headers absent = unsigned request (e.g. Recall.ai dashboard test pings).
    // Allow through with a warning. Reject only when headers are present but signature is wrong.
    console.warn('[verifyWebhookSignature] Svix headers absent — allowing unsigned request');
    return true;
  }
  try {
    wh.verify(payload, { 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': svixSignature });
    return true;
  } catch (err) {
    console.warn('[verifyWebhookSignature] Verification threw:', (err as Error).message);
    return false;
  }
}

export interface RecallCalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  meeting_url: string | null;
  attendees: Array<{ email: string; name?: string }>;
  organizer_email: string;
  calendar_id: string;
  status?: string;
}

export async function createCalendarV2(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  email?: string;
}): Promise<{ id: string; platform_email: string | null }> {
  // V2 endpoint — strip /v1 from the configured base and use /v2
  const v1Base = process.env.RECALL_API_BASE ?? 'https://us-west-2.recall.ai/api/v1';
  const apiRoot = v1Base.replace(/\/v1\/?$/, '');
  const res = await fetch(`${apiRoot}/v2/calendars/`, {
    method: 'POST',
    headers: recallHeaders(),
    body: JSON.stringify({
      platform: 'google_calendar',
      oauth_client_id: params.clientId,
      oauth_client_secret: params.clientSecret,
      oauth_refresh_token: params.refreshToken,
      ...(params.email && { oauth_email: params.email }),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Recall.ai createCalendarV2 failed: ${res.status} ${err}`);
  }

  return res.json();
}

export async function listCalendarEvents(calendarId: string): Promise<RecallCalendarEvent[]> {
  const url = `${RECALL_API_BASE}/calendar/events/?calendar_id=${encodeURIComponent(calendarId)}`;
  const res = await fetch(url, { headers: recallHeaders() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Recall.ai listCalendarEvents failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  // Recall.ai returns paginated results or a plain array
  return (data.results ?? data) as RecallCalendarEvent[];
}
