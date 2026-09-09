import { z } from 'zod';
import { studioDraftSchema, type StudioDraft } from './studio';

/** How many versions of a production are kept on disk (oldest dropped first). */
export const STUDIO_DOC_HISTORY_LIMIT = 40;

export const studioDocVersionSchema = z.object({
  version: z.number().int().positive(),
  savedAt: z.string(),
  label: z.string().max(200),
  draft: studioDraftSchema,
});
export const studioDocSchema = z.object({
  schema: z.literal(1),
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(150),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().positive(),
  current: studioDraftSchema,
  history: z.array(studioDocVersionSchema).min(1).max(200),
});
export type StudioDoc = z.infer<typeof studioDocSchema>;
export type StudioDocVersion = z.infer<typeof studioDocVersionSchema>;

export interface StudioDocSummary {
  id: string;
  title: string;
  updatedAt: string;
  version: number;
  versions: number;
}

export function summarizeStudioDoc(doc: StudioDoc): StudioDocSummary {
  return {
    id: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    version: doc.version,
    versions: doc.history.length,
  };
}

function appendVersion(doc: StudioDoc, entry: StudioDocVersion): StudioDoc {
  return {
    ...doc,
    history: [...doc.history, entry].slice(-STUDIO_DOC_HISTORY_LIMIT),
    current: entry.draft,
    version: entry.version,
    updatedAt: entry.savedAt,
    title: entry.draft.title,
  };
}

/** Pure: a brand-new production document at version 1. */
export function createStudioDoc(
  id: string,
  draft: StudioDraft,
  now: string,
): StudioDoc {
  const current = studioDraftSchema.parse(draft);
  return {
    schema: 1,
    id,
    title: current.title,
    createdAt: now,
    updatedAt: now,
    version: 1,
    current,
    history: [{ version: 1, savedAt: now, label: 'Created', draft: current }],
  };
}

/** Pure: append the draft as the next version. */
export function updateStudioDoc(
  doc: StudioDoc,
  draft: StudioDraft,
  label: string,
  now: string,
): StudioDoc {
  const parsed = studioDocSchema.parse(doc);
  const next = studioDraftSchema.parse(draft);
  return appendVersion(parsed, {
    version: parsed.version + 1,
    savedAt: now,
    label: label.trim().slice(0, 200) || `Version ${parsed.version + 1}`,
    draft: next,
  });
}

/** Pure: re-adopt a past version as a new version (nothing is overwritten). */
export function restoreStudioDocVersion(
  doc: StudioDoc,
  version: number,
  now: string,
): StudioDoc {
  const parsed = studioDocSchema.parse(doc);
  const target = parsed.history.find((entry) => entry.version === version);
  if (!target)
    throw new Error(`Version ${version} is not in this production’s history`);
  return updateStudioDoc(
    parsed,
    target.draft,
    `Restored version ${version}`,
    now,
  );
}
