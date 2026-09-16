const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async function verifyPackagedRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;
  require('./verify-packaged-notices.cjs')(context.appOutDir);
  const modules = path.join(context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');
  const cpp = path.join(modules, 'nodejs-whisper', 'cpp', 'whisper.cpp');
  const executable = ['build/bin/Release', 'build/bin', 'build/bin/Debug', 'build', ''].map(dir => path.join(cpp, dir, 'whisper-cli.exe')).find(file => fs.existsSync(file));
  const model = path.join(cpp, 'models', 'ggml-base.en.bin');
  if (!executable || !fs.existsSync(model) || fs.statSync(model).size < 1024 * 1024) throw new Error('Packaged Whisper engine/model is missing. Build and supply the runtime before releasing USCut.');
  const ffmpeg = path.join(context.appOutDir, 'resources', 'ffmpeg', 'ffmpeg.exe');
  if (!fs.existsSync(ffmpeg)) throw new Error('Packaged LGPL ffmpeg.exe is missing from resources/ffmpeg.');
  execFileSync(ffmpeg, ['-version'], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
  // h264_mf is a Windows Media Foundation encoder — its real availability
  // depends on the runtime environment (not just the binary), so this does a
  // real one-frame encode rather than trusting -encoders' static list.
  const mfProbe = path.join(context.appOutDir, '__mf-probe.mp4');
  try {
    execFileSync(
      ffmpeg,
      ['-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.2', '-c:v', 'h264_mf', '-pix_fmt', 'yuv420p', '-y', mfProbe],
      { windowsHide: true, timeout: 15000, stdio: 'pipe' },
    );
    if (!fs.existsSync(mfProbe) || fs.statSync(mfProbe).size < 100) throw new Error('h264_mf produced no output.');
  } finally {
    fs.rmSync(mfProbe, { force: true });
  }
  execFileSync(executable, ['--help'], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
  console.log('Packaged FFmpeg (LGPL, h264_mf) and Whisper start successfully; base.en model is present.');
};
