-- MeetingHub Database Schema
-- Run this in your Supabase SQL editor

CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_bot_id TEXT UNIQUE,
  calendar_event_id TEXT,
  title TEXT NOT NULL,
  meeting_date TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,
  meet_url TEXT,
  client_slug TEXT,
  status TEXT DEFAULT 'scheduled',
  r2_video_key TEXT,
  r2_audio_key TEXT,
  share_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  is_external BOOLEAN DEFAULT true,
  speaker_id INTEGER,
  talk_time_seconds INTEGER,
  talk_time_percentage NUMERIC(5,2)
);

CREATE TABLE transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  raw_deepgram JSONB,
  paragraphs JSONB,
  full_text TEXT
);

CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  summary TEXT,
  key_decisions JSONB,
  action_items JSONB,
  open_questions JSONB,
  talk_time JSONB,
  tone_read TEXT,
  model_used TEXT,
  prompt_version TEXT
);

CREATE TABLE blacklist_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE client_domains (
  domain TEXT PRIMARY KEY,
  client_slug TEXT NOT NULL,
  client_name TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_meetings_client_date ON meetings(client_slug, meeting_date DESC);
CREATE INDEX idx_meetings_share_token ON meetings(share_token);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_transcripts_fulltext ON transcripts USING GIN (to_tsvector('english', coalesce(full_text, '')));

-- Default blacklist rules
INSERT INTO blacklist_rules (rule_type, value) VALUES
  ('title_keyword', 'personal'),
  ('title_keyword', 'doctor'),
  ('title_keyword', 'therapy'),
  ('title_keyword', 'dentist'),
  ('title_keyword', '1:1 with');

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
