import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCaptionStyle } from '../captionStyle';

describe('resolveCaptionStyle', () => {
  it('uses the bundled font + color when the font file is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-test-'));
    fs.writeFileSync(path.join(dir, 'Montserrat-Bold.ttf'), 'fake');
    fs.writeFileSync(path.join(dir, 'PlayfairDisplay-Bold.ttf'), 'fake');

    expect(resolveCaptionStyle('standard', dir)).toEqual({
      fontFamily: 'Montserrat',
      color: '#ffffff',
    });
    expect(resolveCaptionStyle('luxury', dir)).toEqual({
      fontFamily: 'Playfair Display',
      color: '#d4af37',
    });

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to no fontFamily (libass default) when the font file is missing, keeping the tier color', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonts-empty-'));
    expect(resolveCaptionStyle('standard', dir)).toEqual({
      fontFamily: undefined,
      color: '#ffffff',
    });
    expect(resolveCaptionStyle('luxury', dir)).toEqual({
      fontFamily: undefined,
      color: '#d4af37',
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back cleanly when fontsDir is null/undefined', () => {
    expect(resolveCaptionStyle('standard', null)).toEqual({
      fontFamily: undefined,
      color: '#ffffff',
    });
    expect(resolveCaptionStyle('luxury', undefined)).toEqual({
      fontFamily: undefined,
      color: '#d4af37',
    });
  });
});
