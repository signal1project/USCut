import { describe, expect, it } from 'vitest';
import {
  createStudioDoc,
  updateStudioDoc,
  restoreStudioDocVersion,
  summarizeStudioDoc,
  STUDIO_DOC_HISTORY_LIMIT,
  studioDocSchema,
} from '../../../../commont/studioDoc';
import type { StudioDraft } from '../../../../commont/studio';

const draft = (title: string, headline = 'A'): StudioDraft => ({
  title,
  brief: 'b',
  music: null,
  assets: [{ id: 'v', src: 'v.mp4', name: 'V', type: 'video', duration: 12 }],
  scenes: [
    { assetId: 'v', sourceStart: 0, duration: 4, headline, narration: '' },
  ],
});

describe('Studio production documents', () => {
  it('creates a valid v1 document with one history entry', () => {
    const doc = createStudioDoc('p1', draft('Launch'), '2026-09-09T00:00:00Z');
    expect(() => studioDocSchema.parse(doc)).not.toThrow();
    expect(doc.version).toBe(1);
    expect(doc.history).toHaveLength(1);
    expect(doc.current.title).toBe('Launch');
    expect(summarizeStudioDoc(doc)).toMatchObject({ version: 1, versions: 1 });
  });

  it('appends each save as a new immutable version and mirrors the latest', () => {
    let doc = createStudioDoc(
      'p1',
      draft('Launch', 'A'),
      '2026-09-09T00:00:00Z',
    );
    doc = updateStudioDoc(
      doc,
      draft('Launch', 'B'),
      'tighten hook',
      '2026-09-09T01:00:00Z',
    );
    doc = updateStudioDoc(
      doc,
      draft('Launch v2', 'C'),
      '',
      '2026-09-09T02:00:00Z',
    );
    expect(doc.version).toBe(3);
    expect(doc.title).toBe('Launch v2');
    expect(doc.current.scenes[0].headline).toBe('C');
    expect(doc.history.map((h) => h.version)).toEqual([1, 2, 3]);
    expect(doc.history[0].draft.scenes[0].headline).toBe('A'); // v1 preserved
    expect(doc.history[1].label).toBe('tighten hook');
    expect(doc.history[2].label).toBe('Version 3'); // empty label -> default
  });

  it('restores a past version as a new version without losing anything', () => {
    let doc = createStudioDoc('p1', draft('L', 'A'), '2026-09-09T00:00:00Z');
    doc = updateStudioDoc(doc, draft('L', 'B'), 'b', '2026-09-09T01:00:00Z');
    doc = restoreStudioDocVersion(doc, 1, '2026-09-09T02:00:00Z');
    expect(doc.version).toBe(3);
    expect(doc.current.scenes[0].headline).toBe('A');
    expect(doc.history.map((h) => h.version)).toEqual([1, 2, 3]);
    expect(doc.history[2].label).toBe('Restored version 1');
    expect(() =>
      restoreStudioDocVersion(doc, 99, '2026-09-09T03:00:00Z'),
    ).toThrow('not in this production');
  });

  it('caps stored history, keeping the newest versions', () => {
    let doc = createStudioDoc('p1', draft('L'), '2026-09-09T00:00:00Z');
    for (let i = 0; i < STUDIO_DOC_HISTORY_LIMIT + 15; i++)
      doc = updateStudioDoc(doc, draft('L', `h${i}`), '', `2026-09-09T${i}`);
    expect(doc.history).toHaveLength(STUDIO_DOC_HISTORY_LIMIT);
    expect(doc.history[doc.history.length - 1].version).toBe(doc.version);
    expect(doc.history[0].version).toBe(
      doc.version - STUDIO_DOC_HISTORY_LIMIT + 1,
    );
  });
});
