/**
 * Main processing pipeline — runs after meeting ends.
 * Steps follow spec §6 exactly.
 */
import { supabase } from '../supabase/client';
import { getBotRecording } from '../recall/client';
import { downloadFromUrl, uploadToR2, uploadJsonToR2, buildR2Key } from '../r2/storage';
import { transcribeAudio, mapSpeakers, calculateTalkTime, buildFullText } from '../deepgram/transcribe';
import { analyzeMeeting } from '../claude/analyze';
import { sendMeetingEmail, buildMeetingEmailHtml } from '../gmail/send';
import { generatePresignedUrl } from '../r2/storage';

export async function processMeeting(meetingId: string) {
  console.log(`[pipeline] Starting processing for meeting ${meetingId}`);

  // Load meeting record
  const { data: meeting, error: meetingErr } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .single();

  if (meetingErr || !meeting) throw new Error(`Meeting ${meetingId} not found`);

  const meetingDate = new Date(meeting.meeting_date);

  try {
    // ── Step 2: Download video from Recall.ai and upload to R2 ──────────────
    console.log(`[pipeline] Step 2: Storing video for ${meetingId}`);
    const botData = await getBotRecording(meeting.recall_bot_id);
    // Recall.ai returns recordings[].media_shortcuts.video_mixed.data.download_url
    const videoUrl =
      botData.recordings?.[0]?.media_shortcuts?.video_mixed?.data?.download_url ??
      botData.video?.download_url ??
      botData.recording_url;
    if (!videoUrl) throw new Error(`No video URL from Recall.ai. Bot data keys: ${Object.keys(botData).join(', ')}`);

    const videoBuffer = await downloadFromUrl(videoUrl);
    const videoKey = buildR2Key(meetingId, meetingDate, 'video.mp4');

    await uploadToR2({ key: videoKey, body: videoBuffer, contentType: 'video/mp4' });

    await supabase
      .from('meetings')
      .update({ r2_video_key: videoKey, updated_at: new Date().toISOString() })
      .eq('id', meetingId);

    // ── Step 3: Transcribe via Deepgram ──────────────────────────────────────
    console.log(`[pipeline] Step 3: Transcribing ${meetingId}`);
    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('meeting_id', meetingId);

    let deepgramResponse;
    try {
      // Use R2 presigned URL so Deepgram fetches it directly — no re-download
      const presignedVideoUrl = await generatePresignedUrl(videoKey, 3600);
      deepgramResponse = await transcribeAudio(presignedVideoUrl);
    } catch (err) {
      await supabase
        .from('meetings')
        .update({ status: 'failed_transcription', updated_at: new Date().toISOString() })
        .eq('id', meetingId);
      throw err;
    }

    const mappedParagraphs = mapSpeakers(deepgramResponse, participants ?? []);
    const talkTime = calculateTalkTime(deepgramResponse, participants ?? []);
    const fullText = buildFullText(mappedParagraphs);

    await supabase.from('transcripts').insert({
      meeting_id: meetingId,
      raw_deepgram: deepgramResponse,
      paragraphs: mappedParagraphs,
      full_text: fullText,
    });

    // Upload transcript to R2 as well
    await uploadJsonToR2(buildR2Key(meetingId, meetingDate, 'transcript.json'), deepgramResponse);

    // Update participant talk times
    for (const [speakerName, time] of Object.entries(talkTime)) {
      const participant = (participants ?? []).find(
        (p) => p.name === speakerName
      );
      if (participant) {
        await supabase
          .from('participants')
          .update({
            talk_time_seconds: time.seconds,
            talk_time_percentage: time.percentage,
          })
          .eq('id', participant.id);
      }
    }

    // ── Step 4: Analyze with Claude ──────────────────────────────────────────
    console.log(`[pipeline] Step 4: Analyzing ${meetingId}`);
    let analysis;
    try {
      analysis = await analyzeMeeting({
        transcript: fullText,
        talkTime,
        meetingTitle: meeting.title,
        meetingDate: meeting.meeting_date,
      });
    } catch (err) {
      console.error(`[pipeline] Analysis failed for ${meetingId}, continuing without it:`, err);
      analysis = null;
    }

    if (analysis) {
      await supabase.from('analyses').insert({ meeting_id: meetingId, ...analysis });
      await uploadJsonToR2(buildR2Key(meetingId, meetingDate, 'analysis.json'), analysis);
    }

    // ── Step 5: Derive client slug ────────────────────────────────────────────
    console.log(`[pipeline] Step 5: Deriving client slug for ${meetingId}`);
    let clientSlug = meeting.client_slug;

    if (!clientSlug) {
      const externalParticipants = (participants ?? []).filter((p) => p.is_external && p.email);
      const domains = externalParticipants
        .map((p) => p.email!.split('@')[1])
        .filter(Boolean);

      if (domains.length > 0) {
        // Find most common domain
        const freq = new Map<string, number>();
        for (const d of domains) freq.set(d, (freq.get(d) ?? 0) + 1);
        const topDomain = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];

        const { data: clientMatch } = await supabase
          .from('client_domains')
          .select('client_slug')
          .eq('domain', topDomain)
          .single();

        clientSlug = clientMatch?.client_slug ?? null;
      }

      await supabase
        .from('meetings')
        .update({ client_slug: clientSlug, updated_at: new Date().toISOString() })
        .eq('id', meetingId);
    }

    // ── Step 6: Send email ────────────────────────────────────────────────────
    console.log(`[pipeline] Step 6: Sending email for ${meetingId}`);
    const portalPath = clientSlug
      ? `${clientSlug}/${meetingId}`
      : `unassigned/${meetingId}`;
    const portalUrl = `${process.env.APP_URL}/${portalPath}`;

    const externalEmails = (participants ?? [])
      .filter((p) => p.is_external && p.email)
      .map((p) => p.email!);

    const recipients = [...new Set([...externalEmails, process.env.GMAIL_SENDER_EMAIL!])];

    const durationMin = Math.round((meeting.duration_seconds ?? 0) / 60);
    const formattedDate = new Date(meeting.meeting_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const emailHtml = buildMeetingEmailHtml({
      title: meeting.title,
      date: formattedDate,
      duration: durationMin > 0 ? `${durationMin} minutes` : 'Unknown',
      participantCount: (participants ?? []).length,
      toneRead: analysis?.tone_read ?? 'Recording available — notes processing.',
      portalUrl,
    });

    let emailSent = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sendMeetingEmail({
          to: recipients,
          subject: `Meeting Notes: ${meeting.title} — ${formattedDate}`,
          html: emailHtml,
        });
        emailSent = true;
        break;
      } catch (err) {
        console.error(`[pipeline] Email attempt ${attempt} failed:`, err);
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }

    if (!emailSent) {
      console.error(`[pipeline] Email failed after 3 attempts for meeting ${meetingId}`);
    }

    // ── Step 7: Mark complete ─────────────────────────────────────────────────
    await supabase
      .from('meetings')
      .update({ status: 'complete', updated_at: new Date().toISOString() })
      .eq('id', meetingId);

    console.log(`[pipeline] Complete: meeting ${meetingId}`);
  } catch (err) {
    console.error(`[pipeline] Fatal error for meeting ${meetingId}:`, err);
    await supabase
      .from('meetings')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', meetingId);
    throw err;
  }
}
