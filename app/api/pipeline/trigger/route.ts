import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { processMeeting } from '@/lib/pipeline/process';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Simple auth: require the Recall API key as a bearer token
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.RECALL_API_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const meetingId: string | undefined = body.meetingId;

  if (!meetingId) {
    return NextResponse.json({ error: 'meetingId required' }, { status: 400 });
  }

  waitUntil(
    processMeeting(meetingId).catch((err) => {
      console.error(`[pipeline/trigger] Error for ${meetingId}:`, err);
    })
  );

  return NextResponse.json({ ok: true, meetingId, message: 'Pipeline started' });
}
