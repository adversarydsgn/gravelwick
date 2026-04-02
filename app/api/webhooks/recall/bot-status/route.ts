import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { processMeeting } from '@/lib/pipeline/process';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('[webhook/bot-status] Received:', JSON.stringify(body).substring(0, 300));

    const botId = body.data?.bot_id ?? body.data?.id;
    const statusCode = body.data?.status?.code ?? body.event;

    if (!botId) {
      return NextResponse.json({ ok: true, skipped: 'no_bot_id' });
    }

    // Map Recall.ai status to our status
    const statusMap: Record<string, string> = {
      'joining_call': 'recording',
      'in_call_recording': 'recording',
      'call_ended': 'processing',
      'done': 'processing',
      'recording_done': 'processing',
    };

    const ourStatus = statusMap[statusCode];

    if (!ourStatus) {
      console.log(`[webhook/bot-status] Unhandled status: ${statusCode}`);
      return NextResponse.json({ ok: true, skipped: `unhandled_status_${statusCode}` });
    }

    // Find meeting by bot ID
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('recall_bot_id', botId)
      .single();

    if (!meeting) {
      console.log(`[webhook/bot-status] No meeting found for bot ${botId}`);
      return NextResponse.json({ ok: true, skipped: 'no_meeting' });
    }

    // Update status
    await supabase
      .from('meetings')
      .update({ status: ourStatus, updated_at: new Date().toISOString() })
      .eq('id', meeting.id);

    // If done, kick off processing (non-blocking — return 200 immediately)
    if (ourStatus === 'processing') {
      console.log(`[webhook/bot-status] Meeting ${meeting.id} done — starting pipeline`);
      processMeeting(meeting.id).catch((err) => {
        console.error(`[pipeline] Unhandled error for meeting ${meeting.id}:`, err);
      });
    }

    return NextResponse.json({ ok: true, meeting_id: meeting.id, status: ourStatus });
  } catch (err) {
    console.error('[webhook/bot-status] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
