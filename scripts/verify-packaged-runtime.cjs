const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function verifyPackagedRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;
  const modules = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');
  const cpp = path.join(modules, 'nodejs-whisper', 'cpp', 'whisper.cpp');
  const executable = ['build/bin/Release', 'build/bin', 'build/bin/Debug', 'build', ''].map(dir => path.join(cpp, dir, 'whisper-cli.exe')).find(file => fs.existsSync(file));
  const model = path.join(cpp, 'models', 'ggml-base.en.bin');
  if (!executable || !fs.existsSync(model) || fs.statSync(model).size < 1024 * 1024) throw new Error('Packaged Whisper engine/model is missing. Build and supply the runtime before releasing USCut.');
  const ffmpeg = path.join(modules, 'ffmpeg-static', 'ffmpeg.exe');
  execFileSync(ffmpeg, ['-version'], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
  execFileSync(executable, ['--help'], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
  console.log('Packaged FFmpeg and Whisper start successfully; base.en model is present.');
};
