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
  model_used: string;
  prompt_version: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  meet_url: string | null;
  attendees: Array<{ email: string; name?: string }>;
  organizer_email: string;
  calendar_id: string;
}
