import type { Audit } from '@lexilens/contracts';

function escapeIcs(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n');
}

export function makeIcsCalendar(title: string, timeline: Audit['timelineChecklist']): string {
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events = timeline
    .filter((item) => item.deadline)
    .map((item, index) => {
      const start = item.deadline!.replaceAll(/[-:]/g, '').replace(/\.\d{3}/, '');
      return [
        'BEGIN:VEVENT',
        `UID:lexilens-${index}-${stamp}@local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${start}`,
        `SUMMARY:${escapeIcs(`${title}: ${item.task}`)}`,
        `DESCRIPTION:${escapeIcs('Verify this deadline against the original document.')}`,
        'END:VEVENT',
      ].join('\r\n');
    });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LexiLens//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}
