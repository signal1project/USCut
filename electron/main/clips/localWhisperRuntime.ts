import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const requireCjs = createRequire(import.meta.url);

export function resolveLocalWhisper(modelName = 'base.en'): {
  executable: string;
  model: string;
} {
  if (!/^[a-zA-Z0-9.-]+$/.test(modelName))
    throw new Error('Invalid local transcription model');
  const cpp = path
    .resolve(
      path.dirname(requireCjs.resolve('nodejs-whisper')),
      '../cpp/whisper.cpp',
    )
    .replace('app.asar', 'app.asar.unpacked');
  const name = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const executable = [
    'build/bin/Release',
    'build/bin',
    'build/bin/Debug',
    'build',
    '',
  ]
    .map((dir) => path.join(cpp, dir, name))
    .find((file) => fs.existsSync(file));
  const model = path.join(cpp, 'models', `ggml-${modelName}.bin`);
  if (!executable || !fs.existsSync(model))
    throw new Error(
      'Local transcription files are missing. Repair the USCut installation, supply an SRT/VTT transcript, or configure cloud transcription in Settings.',
    );
  return { executable, model };
}
