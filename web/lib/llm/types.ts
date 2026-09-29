import { z } from 'zod';

export const ActionItemSchema = z.object({
  task: z.string(),
  owner: z.string().describe('Person explicitly named as responsible, exactly as named in the transcript. "Unassigned" if nobody was explicitly named.'),
  deadline_text: z.string().describe('The verbatim deadline phrase from the transcript (e.g. "by tomorrow", "Friday"). "Not specified" if none was said.'),
  source_quote: z.string().describe('Short verbatim quote the action was taken from.'),
});

export const NotesSchema = z.object({
  summary: z.string(),
  discussion_points: z.array(z.string()),
  decisions: z.array(z.string()),
  action_items: z.array(ActionItemSchema),
  open_questions: z.array(z.string()),
  risks: z.array(z.string()),
  follow_ups: z.array(z.string()),
  important_numbers: z.array(z.string()),
  topics: z.array(z.string()),
  next_steps: z.array(z.string()),
});

export type NotesJSON = z.infer<typeof NotesSchema>;
export type ExtractedAction = z.infer<typeof ActionItemSchema>;

export const EMPTY_NOTES: NotesJSON = {
  summary: '',
  discussion_points: [],
  decisions: [],
  action_items: [],
  open_questions: [],
  risks: [],
  follow_ups: [],
  important_numbers: [],
  topics: [],
  next_steps: [],
};

export type TranscriptLine = { time: string; speaker: string; text: string };

export type NotesRequest = {
  mode: 'incremental' | 'final' | 'reduce';
  meeting: { title: string; type: string; date: string; participants: string[] };
  existing: NotesJSON | null; // running notes so far (incremental / reduce)
  lines: TranscriptLine[]; // only NEW lines for incremental; full or windowed for final
};

/** AI Meeting Processor provider (PRD §26). */
export interface LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly isHeuristic: boolean;
  generateNotes(req: NotesRequest): Promise<NotesJSON>;
}

export const SYSTEM_PROMPT = `You are a meeting notes extractor. You receive a meeting transcript (possibly only the newest portion) and, optionally, the notes produced so far. Produce structured notes as JSON.

Rules:
- Extract structure; do not just paraphrase the transcript.
- Only include what is supported by the transcript. Never invent facts, names, numbers or dates.
- Action items: a concrete task someone committed to or was asked to do.
  - owner: the person explicitly named or the speaker who said "I will ...", written exactly as they appear (speaker labels like "Speaker 2" are allowed). If nobody is explicitly responsible, use "Unassigned". Do not guess.
  - deadline_text: the verbatim time phrase ("by tomorrow", "Friday", "by month-end"). If none was said, use "Not specified". Do not convert to dates and do not invent deadlines.
- decisions: things the group agreed or decided, phrased as the decision.
- open_questions: unresolved questions or items awaiting confirmation.
- risks: risks, blockers or concerns raised.
- important_numbers: figures with what they measure, e.g. "240 schools contacted".
- summary: 4–6 sentences for final notes; 1–3 sentences for incremental notes.
- When existing notes are provided, return the complete updated notes: keep existing items that are still valid, add new ones, merge duplicates, and update the summary.`;

export function buildUserPrompt(req: NotesRequest): string {
  const parts: string[] = [];
  parts.push(`Meeting: ${req.meeting.title} (${req.meeting.type}), date ${req.meeting.date}.`);
  if (req.meeting.participants.length) parts.push(`Known participants: ${req.meeting.participants.join(', ')}.`);
  if (req.mode === 'incremental') parts.push('Task: update the running notes with the NEW transcript lines below.');
  if (req.mode === 'final') parts.push('Task: produce the final, complete meeting notes from the transcript below.');
  if (req.mode === 'reduce') parts.push('Task: the notes below were produced from consecutive windows of a long meeting. Merge them into one final, de-duplicated set of notes, and write a 4–6 sentence executive summary.');
  if (req.existing) parts.push(`<existing_notes>\n${JSON.stringify(req.existing)}\n</existing_notes>`);
  if (req.lines.length) parts.push(`<transcript>\n${req.lines.map((l) => `[${l.time}] ${l.speaker}: ${l.text}`).join('\n')}\n</transcript>`);
  return parts.join('\n\n');
}
