import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { shouldSkipMeeting } from '@/lib/recall/blacklist';
import { scheduleBot, verifyWebhookSignature, listCalendarEvents } from '@/lib/recall/client';
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
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.warn('[webhook/calendar] RECALL_WEBHOOK_SECRET not set — skipping signature verification');
    }

    const body = JSON.parse(rawBody);
    const eventType: string = body.event ?? '';
    console.log('[webhook/calendar] Received event:', eventType);

    // calendar.update — settings changed, no action needed
    if (eventType === 'calendar.update') {
      return NextResponse.json({ ok: true, skipped: 'calendar_update' });
    }

    // calendar.sync_events — Recall.ai synced the calendar; fetch actual events from API
    if (eventType === 'calendar.sync_events') {
      const calendarId: string | undefined = body.data?.calendar_id;
      if (!calendarId) {
        console.warn('[webhook/calendar] calendar.sync_events missing calendar_id');
        return NextResponse.json({ ok: true, skipped: 'no_calendar_id' });
      }

      console.log('[webhook/calendar] Fetching events for calendar:', calendarId);
      const events = await listCalendarEvents(calendarId);
      const now = new Date();
      let scheduled = 0;
      let skipped = 0;

      for (const evt of events) {
        if (!evt.meeting_url) continue;
        if (new Date(evt.start_time) < now) continue; // ignore past events

        // Skip if already scheduled
        const { data: existing } = await supabase
          .from('meetings')
          .select('id, recall_bot_id')
          .eq('calendar_event_id', evt.id)
          .maybeSingle();

        if (existing?.recall_bot_id) {
          console.log(`[webhook/calendar] Already scheduled for event ${evt.id}, skipping`);
          continue;
        }

        const calEvent: CalendarEvent = {
          id: evt.id,
          title: evt.title ?? 'Untitled Meeting',
          start_time: evt.start_time,
          end_time: evt.end_time,
          meet_url: evt.meeting_url,
          attendees: evt.attendees ?? [],
          organizer_email: evt.organizer_email ?? '',
          calendar_id: evt.calendar_id ?? calendarId,
        };

        const skip = await shouldSkipMeeting(calEvent);
        if (skip) {
          await supabase.from('meetings').upsert({
            calendar_event_id: evt.id,
            title: calEvent.title,
            meeting_date: evt.start_time,
            meet_url: evt.meeting_url,
            status: 'skipped',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'calendar_event_id' });
          skipped++;
          continue;
        }

        const bot = await scheduleBot({ meetingUrl: evt.meeting_url, joinAt: evt.start_time });

        const participantInserts = calEvent.attendees.map((a) => ({
          name: a.name ?? null,
          email: a.email,
          is_external: !a.email.endsWith('@adversary.design'),
        }));

        const { data: meeting } = await supabase
          .from('meetings')
          .upsert({
            calendar_event_id: evt.id,
            recall_bot_id: bot.id,
            title: calEvent.title,
            meeting_date: evt.start_time,
            meet_url: evt.meeting_url,
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

        console.log(`[webhook/calendar] Bot ${bot.id} scheduled for "${calEvent.title}"`);
        scheduled++;
      }

      return NextResponse.json({ ok: true, scheduled, skipped });
    }

    // Fallback: direct calendar event payload (legacy / future format)
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

    const skip = await shouldSkipMeeting(event);
    if (skip) {
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

    const bot = await scheduleBot({ meetingUrl: event.meet_url, joinAt: event.start_time });

    const participantInserts = event.attendees.map((a) => ({
      name: a.name ?? null,
      email: a.email,
      is_external: !a.email.endsWith('@adversary.design'),
    }));

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
