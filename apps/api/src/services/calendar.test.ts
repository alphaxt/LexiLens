import { describe, expect, it } from 'vitest';
import { makeIcsCalendar } from './calendar';

describe('calendar export', () => {
  it('creates an RFC 5545-shaped calendar only for confirmed deadlines', () => {
    const result = makeIcsCalendar('Agreement', [
      { step: 1, task: 'Send notice', deadline: '2026-06-01T00:00:00.000Z', deadlineType: 'EXACT_DATE', mandatory: true, sourceClauseIds: ['c1'], needsUserContext: false },
      { step: 2, task: 'Confirm renewal date', deadline: null, deadlineType: 'RELATIVE_TO_EVENT', mandatory: true, sourceClauseIds: ['c2'], needsUserContext: true },
    ]);
    expect(result).toContain('BEGIN:VCALENDAR');
    expect(result).toContain('SUMMARY:Agreement: Send notice');
    expect(result).not.toContain('Confirm renewal date');
  });
});
