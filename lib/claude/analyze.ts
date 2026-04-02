import Anthropic from '@anthropic-ai/sdk';
import type { Analysis } from '@/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Watson, an AI meeting analyst for Adversary, a design agency.
Analyze the following meeting transcript and produce a structured JSON response.

Requirements:
- summary: 2-3 paragraph narrative summary of the meeting. Written in third person, professional tone. Focus on what was discussed, decided, and left open.
- key_decisions: Array of objects {decision: string, context: string}. Only include actual decisions made, not topics discussed.
- action_items: Array of objects {item: string, assignee: string|null, deadline: string|null}. Extract from explicit commitments ("I'll do X by Y").
- open_questions: Array of strings. Things raised but not resolved.
- talk_time: Object mapping speaker names to {seconds: number, percentage: number}. Use the provided talk time data.
- tone_read: One sentence characterizing the meeting's energy/sentiment (e.g., "Productive working session with strong alignment on direction" or "Tense discussion around budget with unresolved disagreement").

Return ONLY valid JSON. No markdown, no commentary.`;

const PROMPT_VERSION = '1.0.0';

export async function analyzeMeeting(params: {
  transcript: string;
  talkTime: Record<string, { seconds: number; percentage: number }>;
  meetingTitle: string;
  meetingDate: string;
}): Promise<Omit<Analysis, 'id' | 'meeting_id'>> {
  const userMessage = `Meeting: ${params.meetingTitle}
Date: ${params.meetingDate}

Talk time data:
${JSON.stringify(params.talkTime, null, 2)}

Transcript:
${params.transcript}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  let parsed: {
    summary?: string;
    key_decisions?: Analysis['key_decisions'];
    action_items?: Analysis['action_items'];
    open_questions?: string[];
    talk_time?: Analysis['talk_time'];
    tone_read?: string;
  };

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Claude returned invalid JSON: ${text.substring(0, 200)}`);
  }

  return {
    summary: parsed.summary ?? null,
    key_decisions: parsed.key_decisions ?? null,
    action_items: parsed.action_items ?? null,
    open_questions: parsed.open_questions ?? null,
    talk_time: parsed.talk_time ?? params.talkTime,
    tone_read: parsed.tone_read ?? null,
    model_used: 'claude-sonnet-4-6',
    prompt_version: PROMPT_VERSION,
  };
}
