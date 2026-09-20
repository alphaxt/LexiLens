import { describe, expect, it } from 'vitest';
import { riskLabel, sliceSource } from './presentation';

describe('Document X-Ray presentation', () => {
  it('uses clear non-color severity labels', () => {
    expect(riskLabel('TRAP')).toBe('High risk');
    expect(riskLabel('CAUTION')).toBe('Review carefully');
    expect(riskLabel('SAFE')).toBe('Standard signal');
  });

  it('uses exact evidence offsets even when text is repeated', () => {
    expect(sliceSource('fee then fee', [9, 12])).toEqual({
      before: 'fee then ',
      selected: 'fee',
      after: '',
    });
  });

  it('safely bounds invalid source offsets', () => {
    expect(sliceSource('terms', [-3, 20])).toEqual({ before: '', selected: 'terms', after: '' });
  });
});
