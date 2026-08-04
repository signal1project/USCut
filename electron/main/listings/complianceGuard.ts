/**
 * ComplianceGuard — ported from BLK INK Scraper (archived 2026-07-07).
 *
 * Hard gate against Fair Housing Act and RESPA violations.
 * Runs on captured listing descriptions and on any listing-ad copy
 * BEFORE it is approved for publishing.
 *
 * Fair Housing Act (42 U.S.C. § 3604):
 *   - Prohibits advertising indicating preference/limitation based on
 *     race, color, national origin, religion, sex, familial status, disability.
 * RESPA (12 U.S.C. § 2607):
 *   - Prohibits undisclosed kickbacks and referral fees in real estate settlements.
 */

export interface ComplianceResult {
  ok: boolean;
  flags: ComplianceFlag[];
}

export interface ComplianceFlag {
  rule: string;
  severity: 'block' | 'warn';
  matched: string;
  detail: string;
}

// ── Fair Housing protected-class terms ─────────────────────────────────────
// These terms signal discriminatory preference/limitation when used to
// describe a property's desirability or target audience.
const FAIR_HOUSING_BLOCKED: {
  pattern: RegExp;
  rule: string;
  detail: string;
}[] = [
  // Race / National Origin
  {
    pattern:
      /\b(white[s]?\s+(only|preferred|neighborhood|area)|blacks?\s+only|no\s+(blacks?|whites?|asians?|hispanics?|latinos?|mexicans?))\b/i,
    rule: 'FH-RACE',
    detail:
      'Explicit racial preference or exclusion is prohibited under the Fair Housing Act.',
  },
  // Religion
  {
    pattern:
      /\b(christian[s]?\s+(only|community|neighborhood)|jewish\s+(only|neighborhood)|no\s+(muslims?|christians?|jews?|catholics?))\b/i,
    rule: 'FH-RELIGION',
    detail:
      'Religious preference or exclusion is prohibited under the Fair Housing Act.',
  },
  // Familial Status
  {
    pattern:
      /\b(no\s+(kids?|children|families|families\s+with\s+children)|adults?\s+only|mature\s+(adults?|community)|child[- ]?free)\b/i,
    rule: 'FH-FAMILIAL',
    detail:
      'Excluding families with children is prohibited. Exception: qualifying 55+ communities.',
  },
  // Disability
  {
    pattern:
      /\b(no\s+(disabled|handicapped|wheelchairs?)|able[- ]?bodied\s+only)\b/i,
    rule: 'FH-DISABILITY',
    detail:
      'Excluding persons with disabilities is prohibited under the Fair Housing Act.',
  },
  // Sex / Gender
  {
    pattern:
      /\b(females?\s+only|males?\s+only|no\s+(men|women|females?|males?))\b/i,
    rule: 'FH-SEX',
    detail:
      'Sex-based preference or exclusion is prohibited under the Fair Housing Act.',
  },
  // Steering language (subtle discrimination signals)
  {
    pattern:
      /\b(good\s+(schools?|neighborhood)s?\s+for\s+(families?|children)|great\s+for\s+(young\s+professionals?|couples?\s+without\s+children))\b/i,
    rule: 'FH-STEERING-WARN',
    detail:
      'This language may indicate steering. Describe property features rather than targeting demographics.',
  },
];

const FAIR_HOUSING_WARN: { pattern: RegExp; rule: string; detail: string }[] = [
  // Neighbourhood descriptions that proxy for protected class
  {
    pattern:
      /\b(exclusive|prestigious|elite|high[- ]class)\s+(neighborhood|area|community)\b/i,
    rule: 'FH-EXCLUSIVITY-WARN',
    detail:
      'Terms implying exclusivity can signal preference for certain groups. Consider neutral phrasing.',
  },
  // "Perfect for" targeting demographics
  {
    pattern:
      /\bperfect\s+for\s+(young\s+professionals?|retirees|empty\s+nesters?|singles?)\b/i,
    rule: 'FH-TARGETING-WARN',
    detail:
      'Targeting specific life stages may imply preference against families with children.',
  },
];

// ── RESPA rules ───────────────────────────────────────────────────────────────
const RESPA_BLOCKED: { pattern: RegExp; rule: string; detail: string }[] = [
  {
    pattern:
      /\b(referral\s+fee|kickback|split\s+commission|fee\s+for\s+referral)\b/i,
    rule: 'RESPA-KICKBACK',
    detail: 'Advertising referral fees or kickbacks violates RESPA § 8.',
  },
];

// ── Required disclosure warnings ─────────────────────────────────────────────
// Not a violation per se, but should warn the agent to add disclosure.
const DISCLOSURE_WARN: { pattern: RegExp; rule: string; detail: string }[] = [
  {
    pattern: /\b(investment\s+property|guaranteed\s+(return|income|rent))\b/i,
    rule: 'DISCLOSURE-INVESTMENT',
    detail:
      'Investment return claims require factual substantiation and disclosure.',
  },
  {
    pattern: /\b(as[- ]is|sold\s+as[- ]is)\b/i,
    rule: 'DISCLOSURE-AS-IS',
    detail: 'As-is sales may have disclosure requirements under state law.',
  },
];

export class ComplianceGuard {
  check(content: string): ComplianceResult {
    const flags: ComplianceFlag[] = [];

    for (const rule of FAIR_HOUSING_BLOCKED) {
      const m = content.match(rule.pattern);
      if (m) {
        flags.push({
          rule: rule.rule,
          severity: rule.rule.endsWith('WARN') ? 'warn' : 'block',
          matched: m[0],
          detail: rule.detail,
        });
      }
    }

    for (const rule of FAIR_HOUSING_WARN) {
      const m = content.match(rule.pattern);
      if (m)
        flags.push({
          rule: rule.rule,
          severity: 'warn',
          matched: m[0],
          detail: rule.detail,
        });
    }

    for (const rule of RESPA_BLOCKED) {
      const m = content.match(rule.pattern);
      if (m)
        flags.push({
          rule: rule.rule,
          severity: 'block',
          matched: m[0],
          detail: rule.detail,
        });
    }

    for (const rule of DISCLOSURE_WARN) {
      const m = content.match(rule.pattern);
      if (m)
        flags.push({
          rule: rule.rule,
          severity: 'warn',
          matched: m[0],
          detail: rule.detail,
        });
    }

    const hasBlock = flags.some((f) => f.severity === 'block');
    return { ok: !hasBlock, flags };
  }
}
