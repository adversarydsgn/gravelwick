import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { shouldSkipMeeting } from '@/lib/recall/blacklist';
import { scheduleBot, verifyWebhookSignature } from '@/lib/recall/client';
import type { CalendarEvent } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify Svix signature if secret is configured
    const secret = process.env.RECALL_WEBHOOK_SECRET;
    if (secret) {
      const svixHeaders = {
        'svix-id': req.headers.get('svix-id'),
        'svix-timestamp': req.headers.get('svix-timestamp'),
        'svix-signature': req.headers.get('svix-signature'),
      };
      if (!verifyWebhookSignature(rawBody, svixHeaders, secret)) {
        console.warn('[webhook/calendar] Signature verification failed');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.warn('[webhook/calendar] RECALL_WEBHOOK_SECRET not set — skipping signature verification');
    }

    const body = JSON.parse(rawBody);
    console.log('[webhook/calendar] Received:', JSON.stringify(body).substring(0, 300));

    // Extract calendar event from Recall.ai payload
    const event: CalendarEvent = {
      id: body.data?.calendar_event?.id ?? body.data?.id,
      title: body.data?.calendar_event?.title ?? body.data?.title ?? 'Untitled Meeting',
      start_time: body.data?.calendar_event?.start_time ?? body.data?.start_time,
      end_time: body.data?.calendar_event?.end_time ?? body.data?.end_time,
      meet_url: body.data?.calendar_event?.meeting_url ?? body.data?.meeting_url,
      attendees: body.data?.calendar_event?.attendees ?? body.data?.attendees ?? [],
      organizer_email: body.data?.calendar_event?.organizer_email ?? body.data?.organizer_email ?? '',
      calendar_id: body.data?.calendar_event?.calendar_id ?? body.data?.calendar_id ?? '',
    };

    if (!event.meet_url) {
      console.log('[webhook/calendar] No meet URL, skipping');
      return NextResponse.json({ ok: true, skipped: 'no_meet_url' });
    }

    // Check blacklist BEFORE scheduling bot
    const skip = await shouldSkipMeeting(event);
    if (skip) {
      // Upsert meeting record as skipped
      await supabase.from('meetings').upsert({
        calendar_event_id: event.id,
        title: event.title,
        meeting_date: event.start_time,
        meet_url: event.meet_url,
        status: 'skipped',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'calendar_event_id' });

      return NextResponse.json({ ok: true, skipped: 'blacklisted' });
    }

    // Schedule Watson bot
    const bot = await scheduleBot({
      meetingUrl: event.meet_url,
      joinAt: event.start_time,
    });

    // Store participants
    const participantInserts = event.attendees.map((a) => ({
      name: a.name ?? null,
      email: a.email,
      is_external: !a.email.endsWith('@adversary.design'),
    }));

    // Upsert meeting record
    const { data: meeting } = await supabase
      .from('meetings')
      .upsert({
        calendar_event_id: event.id,
        recall_bot_id: bot.id,
        title: event.title,
        meeting_date: event.start_time,
        meet_url: event.meet_url,
        status: 'scheduled',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'calendar_event_id' })
      .select()
      .single();

    if (meeting && participantInserts.length > 0) {
      await supabase.from('participants').insert(
        participantInserts.map((p) => ({ ...p, meeting_id: meeting.id }))
      );
    }

    console.log(`[webhook/calendar] Bot ${bot.id} scheduled for "${event.title}"`);
    return NextResponse.json({ ok: true, bot_id: bot.id });
  } catch (err) {
    console.error('[webhook/calendar] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
