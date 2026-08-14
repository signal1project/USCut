import type { PubType } from '@mas/types';

/** One-shot media/caption handoff into either social composer. */
export interface ComposerPrefill {
  pubType: PubType;
  mediaRef: string;
  body?: string;
}
