import type { TranscriptParagraph } from '@/types';

interface DeepgramUtterance {
  speaker: number;
  start: number;
  end: number;
  transcript: string;
}

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  speaker: number;
  speaker_confidence: number;
  confidence: number;
}

interface DeepgramResponse {
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        paragraphs?: {
          paragraphs: Array<{
            speaker: number;
            start: number;
            end: number;
            sentences: Array<{ text: string }>;
          }>;
        };
        words: DeepgramWord[];
      }>;
    }>;
    utterances?: DeepgramUtterance[];
  };
}

export async function transcribeAudio(audioUrl: string): Promise<DeepgramResponse> {
  const params = new URLSearchParams({
    model: 'nova-2',
    diarize: 'true',
    paragraphs: 'true',
    punctuate: 'true',
    utterances: 'true',
    smart_format: 'true',
    language: 'en',
  });

  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: audioUrl }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Deepgram transcription failed: ${res.status} ${err}`);
  }

  return res.json();
}

export function mapSpeakers(
  deepgramResponse: DeepgramResponse,
  participants: Array<{ name: string | null; speaker_id: number | null }>
): TranscriptParagraph[] {
  const speakerMap = new Map<number, string>();

  // Build speaker ID → name map from participant data
  for (const p of participants) {
    if (p.speaker_id !== null && p.name) {
      speakerMap.set(p.speaker_id, p.name);
    }
  }

  const alternative = deepgramResponse.results.channels[0]?.alternatives[0];
  if (!alternative?.paragraphs) return [];

  return alternative.paragraphs.paragraphs.map((para) => ({
    speaker: speakerMap.get(para.speaker) ?? `Speaker ${para.speaker + 1}`,
    speaker_id: para.speaker,
    start: para.start,
    end: para.end,
    text: para.sentences.map((s) => s.text).join(' '),
  }));
}

export function calculateTalkTime(
  deepgramResponse: DeepgramResponse,
  participants: Array<{ name: string | null; speaker_id: number | null }>
): Record<string, { seconds: number; percentage: number }> {
  const speakerMap = new Map<number, string>();
  for (const p of participants) {
    if (p.speaker_id !== null && p.name) {
      speakerMap.set(p.speaker_id, p.name);
    }
  }

  const words = deepgramResponse.results.channels[0]?.alternatives[0]?.words ?? [];
  const speakerSeconds = new Map<number, number>();

  for (const word of words) {
    const duration = word.end - word.start;
    speakerSeconds.set(word.speaker, (speakerSeconds.get(word.speaker) ?? 0) + duration);
  }

  const total = Array.from(speakerSeconds.values()).reduce((a, b) => a + b, 0);
  const result: Record<string, { seconds: number; percentage: number }> = {};

  for (const [speakerId, seconds] of speakerSeconds.entries()) {
    const name = speakerMap.get(speakerId) ?? `Speaker ${speakerId + 1}`;
    result[name] = {
      seconds: Math.round(seconds),
      percentage: total > 0 ? Math.round((seconds / total) * 100 * 10) / 10 : 0,
    };
  }

  return result;
}

export function buildFullText(paragraphs: TranscriptParagraph[]): string {
  return paragraphs
    .map((p) => `${p.speaker}: ${p.text}`)
    .join('\n\n');
}
