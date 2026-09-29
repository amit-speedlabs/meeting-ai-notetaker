import { route, json, preflight } from '@/lib/http';
import { one } from '@/lib/db';
import { transcriptionProviderInfo } from '@/lib/transcription';
import { llmProviderInfo } from '@/lib/llm';

export const OPTIONS = preflight;
export const GET = route(async () => {
  let db = 'ok';
  try {
    await one('select 1');
  } catch {
    db = 'unavailable';
  }
  return json({ app: 'Meeting AI Notetaker', db, transcription: transcriptionProviderInfo(), ai: llmProviderInfo() });
});
