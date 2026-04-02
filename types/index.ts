export type MeetingStatus =
  | 'scheduled'
  | 'recording'
  | 'processing'
  | 'complete'
  | 'failed'
  | 'failed_transcription'
  | 'skipped';

export interface Meeting {
  id: string;
  recall_bot_id: string | null;
  calendar_event_id: string | null;
  title: string;
  meeting_date: string;
  duration_seconds: number | null;
  meet_url: string | null;
  client_slug: string | null;
  status: MeetingStatus;
  r2_video_key: string | null;
  r2_audio_key: string | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Participant {
  id: string;
  meeting_id: string;
  name: string | null;
  email: string | null;
  is_external: boolean;
  speaker_id: number | null;
  talk_time_seconds: number | null;
  talk_time_percentage: number | null;
}

export interface Transcript {
  id: string;
  meeting_id: string;
  raw_deepgram: unknown;
  paragraphs: TranscriptParagraph[] | null;
  full_text: string | null;
}

export interface TranscriptParagraph {
  speaker: string;
  speaker_id: number;
  start: number;
  end: number;
  text: string;
}

export interface Analysis {
  id: string;
  meeting_id: string;
  summary: string | null;
  key_decisions: Array<{ decision: string; context: string }> | null;
  action_items: Array<{ item: string; assignee: string | null; deadline: string | null }> | null;
  open_questions: string[] | null;
  talk_time: Record<string, { seconds: number; percentage: number }> | null;
  tone_read: string | null;
  model_used: string | null;
  prompt_version: string | null;
}

export interface BlacklistRule {
  id: string;
  rule_type: 'title_keyword' | 'email_domain' | 'email_address' | 'calendar_id';
  value: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  meet_url: string;
  attendees: Array<{ email: string; name?: string }>;
  organizer_email: string;
  calendar_id: string;
}

export interface RecallWebhookPayload {
  event: string;
  data: {
    bot_id?: string;
    status?: { code: string };
    meeting_url?: string;
    calendar_event?: CalendarEvent;
    recording_url?: string;
    duration?: number;
    participants?: Array<{ name: string; email?: string; is_host?: boolean }>;
  };
}
