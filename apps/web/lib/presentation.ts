import type { Clause } from '@lexilens/contracts';

export function riskLabel(level: Clause['riskLevel']): string {
  return level === 'TRAP'
    ? 'High risk'
    : level === 'CAUTION'
      ? 'Review carefully'
      : 'Standard signal';
}

export function sliceSource(
  text: string,
  range: readonly [number, number] | null,
): { before: string; selected: string; after: string } {
  if (!range) return { before: text, selected: '', after: '' };
  const start = Math.max(0, Math.min(range[0], text.length));
  const end = Math.max(start, Math.min(range[1], text.length));
  return {
    before: text.slice(0, start),
    selected: text.slice(start, end),
    after: text.slice(end),
  };
}
