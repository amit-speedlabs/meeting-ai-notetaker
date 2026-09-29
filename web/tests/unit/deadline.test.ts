import { describe, it, expect } from 'vitest';
import { resolveDeadline } from '../../lib/deadline';

// Meeting date: Monday 28 September 2026.
const D = '2026-09-28';

describe('resolveDeadline', () => {
  const cases: [string, string | null][] = [
    ['tomorrow', '2026-09-29'],
    ['by tomorrow', '2026-09-29'],
    ['today', '2026-09-28'],
    ['by 6 PM', '2026-09-28'],
    ['end of day', '2026-09-28'],
    ['Friday', '2026-10-02'],
    ['by Friday', '2026-10-02'],
    ['this Friday', '2026-10-02'],
    ['next Friday', '2026-10-09'],
    ['Monday', '2026-09-28'],
    ['next week', '2026-10-05'],
    ['end of next week', '2026-10-09'],
    ['by month-end', '2026-09-30'],
    ['end of the month', '2026-09-30'],
    ['end of this week', '2026-10-02'],
    ['in 3 days', '2026-10-01'],
    ['within two weeks', '2026-10-12'],
    ['by 5 October', '2026-10-05'],
    ['Oct 5th', '2026-10-05'],
    ['5 Jan', '2027-01-05'],
    ['2026-10-15', '2026-10-15'],
    ['15/10', '2026-10-15'],
    ['day after tomorrow', '2026-09-30'],
  ];
  for (const [phrase, expected] of cases) {
    it(`"${phrase}" → ${expected}`, () => {
      const r = resolveDeadline(phrase, D);
      expect(r.date).toBe(expected);
      expect(r.text).toBe(phrase);
    });
  }

  it('keeps ambiguous phrases without inventing a date', () => {
    for (const p of ['before the next meeting', 'soon', 'ASAP', 'later this quarter', '05/10', 'sometime']) {
      const r = resolveDeadline(p, D);
      expect(r.date, p).toBeNull();
      expect(r.text).toBe(p);
    }
  });

  it('returns "Not specified" when no deadline was given', () => {
    expect(resolveDeadline('', D)).toEqual({ date: null, text: 'Not specified' });
    expect(resolveDeadline('Not specified', D)).toEqual({ date: null, text: 'Not specified' });
    expect(resolveDeadline(undefined, D)).toEqual({ date: null, text: 'Not specified' });
  });
});
