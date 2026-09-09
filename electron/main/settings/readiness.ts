import fs from 'node:fs';
import { resolveLocalWhisper } from '../clips/localWhisperRuntime';

import { execFile } from 'node:child_process';
import { safeStorage } from 'electron';
import type { Settings } from './settings';
import { resolveFfmpegPath } from '../../util/ffmpegBinary';
import { getAssetPath } from '../../util';
import { selectMusicTrack } from '../listings/video/musicBed';
import type {
  ReadinessCheck,
  ReadinessReport,
} from '../../../commont/readiness';

/** Local checks only: no provider requests, downloads, or credential disclosure. */
export async function checkReadiness(
  settings: Settings,
): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const add = (
    id: string,
    label: string,
    status: ReadinessCheck['status'],
    detail: string,
  ) => checks.push({ id, label, status, detail });
  const encryption = safeStorage.isEncryptionAvailable();
  add(
    'credentials',
    'Credential protection',
    encryption ? 'ready' : 'attention',
    encryption
      ? 'OS encryption is available.'
      : 'OS encryption is unavailable. Reconnect your OS session before accessing AI credentials.',
  );
  try {
    const provider = settings.getActiveAIProvider();
    add(
      'ai',
      'AI editing',
      provider ? 'configured' : 'attention',
      provider
        ? `${provider.name} is selected. Credentials are saved; service availability has not been tested.`
        : 'Select and connect an AI provider in Settings.',
    );
  } catch {
    add(
      'ai',
      'AI editing',
      'attention',
      'Saved AI credentials could not be read. Check credential protection.',
    );
  }
  const ffmpegReady = await new Promise<boolean>((resolve) => {
    execFile(
      resolveFfmpegPath(),
      ['-version'],
      { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 },
      (err) => resolve(!err),
    );
  });
  add(
    'ffmpeg',
    'Video rendering',
    ffmpegReady ? 'ready' : 'attention',
    ffmpegReady
      ? 'Bundled FFmpeg starts successfully.'
      : 'FFmpeg could not start. Repair the application installation.',
  );
  let localWhisper = false;
  try {
    resolveLocalWhisper();
    localWhisper = true;
  } catch {
    /* Optional dependency may not be installed. */
  }
  add(
    'local-whisper',
    'Local transcription',
    localWhisper ? 'configured' : 'attention',
    localWhisper
      ? 'Whisper executable and base.en model are present; transcription has not been run by this check.'
      : 'Local Whisper executable or model is missing. Use a transcript file or configure cloud transcription.',
  );
  try {
    const cloud = Boolean(settings.getProviderSettings('openai')?.apiKey);
    add(
      'cloud-whisper',
      'Cloud transcription',
      cloud ? 'configured' : 'attention',
      cloud
        ? 'OpenAI key saved. Cloud use incurs provider charges; connectivity is untested.'
        : 'No OpenAI key saved. Use local transcription or supply an SRT/VTT transcript.',
    );
  } catch {
    add(
      'cloud-whisper',
      'Cloud transcription',
      'attention',
      'Cloud credentials could not be read.',
    );
  }
  for (const [id, label, directory] of [
    ['output', 'Generated media folder', settings.getGeneralOutputDir()],
    ['zillow', 'Zillow property folder', settings.getZillowScraperDir()],
  ]) {
    try {
      if (!fs.statSync(directory).isDirectory())
        throw new Error('not directory');
      fs.accessSync(directory, fs.constants.W_OK);
      add(
        id,
        label,
        'ready',
        `${directory} — folder exists and access check passed.`,
      );
    } catch {
      add(
        id,
        label,
        'attention',
        `${directory} — folder missing or inaccessible. Choose and save a folder below.`,
      );
    }
  }
  const musicDir = settings.getMusicDir() ?? getAssetPath('music');
  const standard = Boolean(selectMusicTrack('standard', musicDir));
  const luxury = Boolean(selectMusicTrack('luxury', musicDir));
  add(
    'music',
    'Listing reel music',
    standard && luxury ? 'ready' : 'attention',
    `Standard: ${standard ? 'track available' : 'no track'}. Luxury: ${luxury ? 'track available' : 'no track'}. Reels without a track use narration only.`,
  );
  return { checkedAt: new Date().toISOString(), checks };
}
