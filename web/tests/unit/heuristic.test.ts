import { describe, it, expect } from 'vitest';
import { HeuristicNotes, extractAction } from '../../lib/llm/heuristic';

describe('extractAction', () => {
  it('PRD example: named owner, deadline phrase', () => {
    const a = extractAction('Amit, please send the school list by tomorrow.', 'Speaker 2');
    expect(a).toMatchObject({ task: 'Send the school list', owner: 'Amit', deadline_text: 'by tomorrow' });
  });
  it('"I will" assigns the speaker', () => {
    const a = extractAction('I will share the updated list by 6 PM.', 'Praveen');
    expect(a).toMatchObject({ owner: 'Praveen', deadline_text: 'by 6 PM', task: 'Share the updated list' });
  });
  it('third-person commitment', () => {
    expect(extractAction('Vivek will call the Gujarat schools on Friday.', 'Speaker 1')).toMatchObject({ owner: 'Vivek', deadline_text: 'on Friday' });
  });
  it('no owner → Unassigned, no deadline → Not specified', () => {
    const a = extractAction('We need someone to update the registration tracker.', 'Speaker 1');
    expect(a).toMatchObject({ owner: 'Unassigned', deadline_text: 'Not specified', task: 'Update the registration tracker' });
  });
  it('does not treat plain statements as actions', () => {
    expect(extractAction('The weather was nice today.', 'Speaker 1')).toBeNull();
    expect(extractAction("Let's get started.", 'Speaker 1')).toBeNull();
  });
  it('unknown speaker saying "I will" is not given an invented owner', () => {
    expect(extractAction('I will send the deck tomorrow.', 'Unknown Speaker')).toMatchObject({ owner: 'Unassigned', deadline_text: 'tomorrow' });
  });
});

describe('HeuristicNotes', () => {
  const lines = [
    { time: '10:32:14', speaker: 'Amit', text: 'We need to close the Maharashtra school list today.' },
    { time: '10:32:27', speaker: 'Vivek', text: "Let's prioritise schools where kits have already been distributed." },
    { time: '10:32:41', speaker: 'Praveen', text: 'I will share the updated list by 6 PM.' },
    { time: '10:33:02', speaker: 'Vivek', text: 'So far 240 schools contacted and 180 kits distributed.' },
    { time: '10:33:20', speaker: 'Amit', text: 'Registration numbers for Gujarat are still not confirmed.' },
    { time: '10:33:40', speaker: 'Praveen', text: 'The risk is that some schools might not confirm in time.' },
    { time: '10:34:00', speaker: 'Vivek', text: 'Do we have budget for a second batch of kits?' },
  ];
  it('extracts decisions, actions, numbers, questions and risks', async () => {
    const n = await new HeuristicNotes().generateNotes({ mode: 'final', meeting: { title: 'Weekly Review', type: 'Internal Meeting', date: '2026-09-28', participants: [] }, existing: null, lines });
    expect(n.decisions.join(' ')).toMatch(/Prioritise schools where kits/i);
    expect(n.action_items.find((a) => a.owner === 'Praveen')?.deadline_text).toBe('by 6 PM');
    expect(n.action_items.find((a) => /Maharashtra/.test(a.task))?.owner).toBe('Unassigned');
    expect(n.important_numbers.join(' ')).toMatch(/240 schools contacted/);
    expect(n.important_numbers.join(' ')).toMatch(/180 kits distributed/);
    expect(n.open_questions.join(' ')).toMatch(/Gujarat/);
    expect(n.open_questions.join(' ')).toMatch(/second batch/);
    expect(n.risks.join(' ')).toMatch(/might not confirm/);
    expect(n.summary.length).toBeGreaterThan(20);
  });
  it('incremental passes merge without duplicating', async () => {
    const p = new HeuristicNotes();
    const meeting = { title: 'T', type: 'Other', date: '2026-09-28', participants: [] };
    const a = await p.generateNotes({ mode: 'incremental', meeting, existing: null, lines: lines.slice(0, 3) });
    const b = await p.generateNotes({ mode: 'incremental', meeting, existing: a, lines: lines.slice(2) });
    expect(b.action_items.filter((x) => x.owner === 'Praveen')).toHaveLength(1);
    expect(b.important_numbers.length).toBeGreaterThan(0);
  });
  it('empty transcript yields empty lists', async () => {
    const n = await new HeuristicNotes().generateNotes({ mode: 'final', meeting: { title: 'T', type: 'Other', date: '2026-09-28', participants: [] }, existing: null, lines: [] });
    expect(n.action_items).toEqual([]);
    expect(n.decisions).toEqual([]);
  });
});
