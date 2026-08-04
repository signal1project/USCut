import { describe, it, expect } from 'vitest';
import { ComplianceGuard } from '../complianceGuard';

const guard = new ComplianceGuard();

describe('ComplianceGuard — Fair Housing', () => {
  it('passes clean listing copy', () => {
    const result = guard.check(
      'Beautiful 3 bed 2 bath home with updated kitchen, hardwood floors, and a large backyard. Schedule a showing today!',
    );
    expect(result.ok).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('blocks explicit racial exclusion', () => {
    const result = guard.check('Great home in a whites only neighborhood.');
    expect(result.ok).toBe(false);
    expect(
      result.flags.some((f) => f.rule === 'FH-RACE' && f.severity === 'block'),
    ).toBe(true);
  });

  it('blocks familial status exclusion', () => {
    const result = guard.check('Quiet building, adults only, no kids.');
    expect(result.ok).toBe(false);
    expect(result.flags.some((f) => f.rule === 'FH-FAMILIAL')).toBe(true);
  });

  it('blocks disability exclusion', () => {
    const result = guard.check('Walk-up unit, no wheelchairs.');
    expect(result.ok).toBe(false);
    expect(result.flags.some((f) => f.rule === 'FH-DISABILITY')).toBe(true);
  });

  it('blocks sex-based exclusion', () => {
    const result = guard.check('Room for rent, females only.');
    expect(result.ok).toBe(false);
    expect(result.flags.some((f) => f.rule === 'FH-SEX')).toBe(true);
  });

  it('warns (does not block) on exclusivity proxy language', () => {
    const result = guard.check(
      'Located in a prestigious neighborhood close to downtown.',
    );
    expect(result.ok).toBe(true);
    expect(
      result.flags.some(
        (f) => f.rule === 'FH-EXCLUSIVITY-WARN' && f.severity === 'warn',
      ),
    ).toBe(true);
  });

  it('warns on life-stage targeting', () => {
    const result = guard.check(
      'This condo is perfect for young professionals.',
    );
    expect(result.ok).toBe(true);
    expect(result.flags.some((f) => f.rule === 'FH-TARGETING-WARN')).toBe(true);
  });
});

describe('ComplianceGuard — RESPA and disclosures', () => {
  it('blocks referral fee advertising', () => {
    const result = guard.check(
      'Agents: earn a referral fee on every buyer you send us!',
    );
    expect(result.ok).toBe(false);
    expect(
      result.flags.some(
        (f) => f.rule === 'RESPA-KICKBACK' && f.severity === 'block',
      ),
    ).toBe(true);
  });

  it('warns on guaranteed return claims', () => {
    const result = guard.check(
      'Turnkey investment property with guaranteed rent.',
    );
    expect(result.ok).toBe(true);
    expect(result.flags.some((f) => f.rule === 'DISCLOSURE-INVESTMENT')).toBe(
      true,
    );
  });

  it('warns on as-is sales', () => {
    const result = guard.check(
      'Fixer-upper sold as-is, bring your contractor.',
    );
    expect(result.ok).toBe(true);
    expect(result.flags.some((f) => f.rule === 'DISCLOSURE-AS-IS')).toBe(true);
  });
});
