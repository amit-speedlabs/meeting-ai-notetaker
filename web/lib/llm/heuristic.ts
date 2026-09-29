import { EMPTY_NOTES, ExtractedAction, LLMProvider, NotesJSON, NotesRequest, TranscriptLine } from './types';

/**
 * Rule-based notes extractor. Needs no API key; used for demos, tests, and as a fallback when the
 * configured LLM is unavailable. It is conservative: it only extracts what matches explicit patterns,
 * so it misses paraphrased commitments that an LLM would catch. It never invents owners or deadlines.
 */
export class HeuristicNotes implements LLMProvider {
  readonly id = 'heuristic';
  readonly label = 'Rule-based extractor (no AI model)';
  readonly isHeuristic = true;

  async generateNotes(req: NotesRequest): Promise<NotesJSON> {
    const base = req.existing ? structuredClone(req.existing) : structuredClone(EMPTY_NOTES);
    const fresh = extractFromLines(req.lines);
    const merged: NotesJSON = {
      summary: '',
      discussion_points: union(base.discussion_points, fresh.discussion_points).slice(0, 15),
      decisions: union(base.decisions, fresh.decisions),
      action_items: unionActions(base.action_items, fresh.action_items),
      open_questions: union(base.open_questions, fresh.open_questions),
      risks: union(base.risks, fresh.risks),
      follow_ups: union(base.follow_ups, fresh.follow_ups),
      important_numbers: union(base.important_numbers, fresh.important_numbers),
      topics: union(base.topics, fresh.topics).slice(0, 10),
      next_steps: [],
    };
    merged.next_steps = union(
      merged.action_items.map((a) => (a.owner !== 'Unassigned' ? `${a.owner}: ${a.task}` : a.task)),
      merged.follow_ups,
    ).slice(0, 10);
    merged.summary = buildSummary(req, merged);
    return merged;
  }
}

const FILLER = /^(ok(ay)?|yes|yeah|yep|no|right|sure|thanks?( you)?( everyone| all)?|great|cool|agreed|hmm+|uh+|um+|so)[.!]*$/i;
const NOT_NAMES = new Set(['We', 'I', 'You', 'It', 'That', 'This', 'There', 'They', 'He', 'She', 'Someone', 'Somebody', 'Everyone', 'Anyone', 'Let', 'Lets', 'So', 'And', 'But', 'Also', 'Then', 'Please', 'Okay', 'Ok', 'Yes', 'No', 'The', 'What', 'Who', 'When', 'Maybe', 'Great', 'Thanks', 'Today', 'Tomorrow', 'Yesterday', 'Friday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday', 'Sunday', 'Agreed', 'Do', 'Can', 'Could', 'Our', 'Let\'s', 'If', 'In', 'For', 'Is', 'Are', 'Not', 'Registrations', 'Registration']);

const DEADLINE_RE = new RegExp(
  [
    String.raw`\b(?:by|before|until|no later than|on)\s+(?:the\s+)?(?:end of (?:the |this |next )?(?:day|week|month)|month[- ]end|eod|eow|today|tonight|tomorrow|day after tomorrow|next week|next month|(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[a-z]{3,9}|[a-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|the next meeting|next meeting)`,
    String.raw`\b(?:in|within)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|ten|fourteen)\s+(?:days?|weeks?)`,
    String.raw`\b(?:tomorrow|today|tonight|end of (?:the |this |next )?(?:day|week|month)|month[- ]end|next week|this week|(?:this |next )(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b`,
  ].join('|'),
  'i',
);

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractFromLines(lines: TranscriptLine[]): NotesJSON {
  const out: NotesJSON = structuredClone(EMPTY_NOTES);
  const wordFreq = new Map<string, number>();
  for (const line of lines) {
    for (const s of splitSentences(line.text)) {
      if (FILLER.test(s) || s.split(/\s+/).length < 3) continue;
      const action = extractAction(s, line.speaker);
      if (action) out.action_items.push(action);
      if (isDecision(s)) out.decisions.push(cleanDecision(s));
      if (/\?\s*$/.test(s) || /\b(still open|not (yet )?confirmed|pending confirmation|to be decided|tbd|unclear|unresolved|open question)\b/i.test(s)) out.open_questions.push(stripLead(s));
      if (/\b(risk|blocker|blocked|concern|might not|may not|won't|will not|delay|delayed|at risk|issue is|problem is)\b/i.test(s) && !/\?\s*$/.test(s)) out.risks.push(stripLead(s));
      if (/\bfollow[- ]?up\b/i.test(s)) out.follow_ups.push(stripLead(s));
      out.important_numbers.push(...extractNumbers(s));
      if (!action && s.split(/\s+/).length >= 6 && !/\?\s*$/.test(s) && !/^(let's get started|thanks|thank you|great, that covers)/i.test(s)) out.discussion_points.push(stripLead(s));
      for (const w of s.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g) || []) {
        if (NOT_NAMES.has(w.split(' ')[0]) || w.length < 3) continue;
        const k = w.toLowerCase().replace(/s$/, '');
        wordFreq.set(k, (wordFreq.get(k) || 0) + 1);
      }
      for (const w of s.toLowerCase().match(/\b(school|schools|registration|registrations|kits?|budget|outreach|tracker|deadline|launch|hiring|pricing|roadmap|release|timeline|contract|proposal|campaign)\b/g) || []) {
        const k = w.replace(/s$/, '');
        wordFreq.set(k, (wordFreq.get(k) || 0) + 1);
      }
    }
  }
  out.topics = [...wordFreq.entries()]
    .filter(([w]) => !/^speaker \d+$/.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAi\b/, 'AI'));
  return out;
}

/** Exported for unit tests. */
export function extractAction(s: string, speaker: string): ExtractedAction | null {
  let owner: string | null = null;
  let body: string | null = null;
  let m: RegExpMatchArray | null;

  // "Vivek, please follow up ..." / "Vivek, can you send ..."
  if ((m = s.match(/^(?:and |so |ok(?:ay)?,? )?([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*(?:please|can you|could you|would you|will you|you need to|make sure (?:you|to))\s+(.+)$/i)) && !NOT_NAMES.has(cap(m[1]))) {
    owner = cap(m[1]);
    body = m[2];
  }
  // "... please send the list, Amit."
  else if ((m = s.match(/^(?:please|can you|could you)\s+(.+?),\s*([A-Z][a-z]+)[.!?]?$/)) && !NOT_NAMES.has(m[2])) {
    owner = m[2];
    body = m[1];
  }
  // "I will / I'll / I am going to / I can take ..."
  else if ((m = s.match(/\b(?:I will|I'll|I am going to|I'm going to|I can take care of|I'll take care of|let me)\s+(.+)$/i))) {
    owner = speaker && speaker !== 'Unknown Speaker' ? speaker : 'Unassigned';
    body = m[1];
  }
  // "Praveen will share ..." / "Praveen is going to ..."
  else if ((m = s.match(/\b([A-Z][a-z]+)\s+(?:will|is going to|needs to|has to|should)\s+(.+)$/)) && !NOT_NAMES.has(m[1]) && !/^Speaker$/.test(m[1])) {
    owner = m[1];
    body = m[2];
  }
  // "We need someone to update ..." / "Someone needs to ..." / "Action item: ..."
  else if ((m = s.match(/\b(?:we need (?:someone|somebody) to|someone (?:needs|has) to|somebody (?:needs|has) to|action item:?|to-?do:?|we need to|we must|we should)\s+(.+)$/i))) {
    owner = 'Unassigned';
    body = m[1];
  }
  if (!owner || !body) return null;
  if (/^(be|go|get started|begin|see|think|talk|discuss|review progress again)\b/i.test(body.trim()) && owner === 'Unassigned') return null;

  // Prefer a deadline inside the task clause; fall back to one elsewhere in the same sentence
  // ("Today we need to ..."), never to other sentences.
  const dl = body.match(DEADLINE_RE) || s.match(DEADLINE_RE);
  const deadline_text = dl ? dl[0].trim() : 'Not specified';
  let task = dl && body.includes(dl[0]) ? body.replace(dl[0], ' ') : body;
  task = task
    .replace(/\b(please|also|just)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:.!?]+$/g, '')
    .trim();
  if (task.split(' ').length < 2) return null;
  return { task: cap(task), owner, deadline_text, source_quote: s };
}

function isDecision(s: string) {
  if (/\?\s*$/.test(s)) return false;
  if (/^let'?s (get started|start|begin|move on|wrap up|review progress)/i.test(s)) return false;
  return /\b(we (?:have )?decided|decision is|we(?:'ll| will) (?:use|go with|proceed|adopt|move forward)|agreed[,.]? (?:we|to)|we agree|let'?s (?:prioriti[sz]e|go with|use|target|finali[sz]e|focus)|final(?:ised|ized)? (?:plan|decision)|approved)\b/i.test(s);
}
function cleanDecision(s: string) {
  return cap(
    s
      .replace(/^(agreed|ok(ay)?|yes|so)[.,]?\s*/i, '')
      .replace(/^(we (?:have )?decided (?:to|that)\s*|let'?s\s+|we(?:'ll| will)\s+)/i, '')
      .replace(/[.!]+$/, ''),
  );
}

function extractNumbers(s: string): string[] {
  const out: string[] = [];
  const clauses = s.split(/,|;|\band\b|\bbut\b/i);
  for (const c of clauses) {
    if (!/\b\d[\d,]*(\.\d+)?\s*(%|percent|lakh|crore|k\b|[a-z]{3,})/i.test(c)) continue;
    if (/\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(c) && !/\b\d{3,}\b/.test(c)) continue;
    const t = c.replace(/^\s*(so far|so|we've|we have|also|registrations are at)\s*/i, (m) => (/registrations/i.test(m) ? 'Registrations: ' : '')).trim().replace(/[.!]+$/, '');
    if (t.split(' ').length <= 12) out.push(cap(t));
  }
  return out;
}

function stripLead(s: string) {
  return cap(s.replace(/^(?:(?:so|okay|ok|well),\s+|(?:and|also|but)\s+)/i, '').trim());
}
function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function union(a: string[], b: string[]) {
  const seen = new Set(a.map(norm));
  const out = [...a];
  for (const x of b) {
    const k = norm(x);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}
function unionActions(a: ExtractedAction[], b: ExtractedAction[]) {
  const seen = new Set(a.map((x) => norm(x.task)));
  return [...a, ...b.filter((x) => !seen.has(norm(x.task)) && seen.add(norm(x.task)))];
}

function buildSummary(req: NotesRequest, n: NotesJSON) {
  const parts: string[] = [];
  const topics = n.topics.slice(0, 4);
  parts.push(
    `${req.meeting.title} (${req.meeting.type.toLowerCase()})${topics.length ? ` covered ${topics.join(', ').toLowerCase()}` : ''}.`,
  );
  if (n.discussion_points[0]) parts.push(`Discussion included: ${n.discussion_points.slice(0, 2).map((d) => d.replace(/[.!]+$/, '')).join('; ')}.`);
  if (n.decisions.length) parts.push(`${n.decisions.length} decision${n.decisions.length > 1 ? 's were' : ' was'} recorded, including: ${n.decisions[0].replace(/[.!]+$/, '')}.`);
  if (n.action_items.length) {
    const assigned = n.action_items.filter((a) => a.owner !== 'Unassigned').length;
    parts.push(`${n.action_items.length} action item${n.action_items.length > 1 ? 's were' : ' was'} identified (${assigned} with an explicit owner).`);
  }
  if (n.open_questions.length || n.risks.length) parts.push(`${n.open_questions.length} open question(s) and ${n.risks.length} risk(s) remain.`);
  parts.push('(Generated by the rule-based extractor; configure an AI provider for richer summaries.)');
  return parts.join(' ');
}
