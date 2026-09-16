// Preserve upstream legal files verbatim, including nested native dependencies.
// The installed dependency tree is deliberately a superset of shipped code:
// renderer libraries may be devDependencies and bundled into dist.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

function generate() {
  const entries = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      if (item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (/^(licen[sc]e|notice|copying|copyright|third[-_ ]party[-_ ]notices)([._-].*)?$/i.test(item.name)) {
        const data = fs.readFileSync(file);
        if (data.includes(0)) throw new Error(`Non-text legal file requires review: ${file}`);
        entries.push({ file: path.relative(root, file).replaceAll('\\', '/'), sha256: sha(data), text: data.toString('utf8') });
      }
    }
  }
  walk(path.join(root, 'node_modules'));
  const notices = path.join(root, 'NOTICES');
  const heading = 'UPSTREAM THIRD-PARTY LICENSES AND ATTRIBUTIONS\n\n'
    + 'Verbatim upstream legal texts from the installed dependency tree. This is a\n'
    + 'conservative superset: development tools listed here are not necessarily\n'
    + 'distributed. Inclusion does not change a component license or license USCut\n'
    + 'under that license. Native library notices retain their original paths.\n\n';
  fs.writeFileSync(path.join(notices, 'THIRD-PARTY.txt'), heading + entries.map(e =>
    `\n${'='.repeat(78)}\nSOURCE FILE: ${e.file}\nSHA256: ${e.sha256}\n${'='.repeat(78)}\n\n${e.text}\n`).join(''));
  const ffmpegDir = path.join(root, 'resources/ffmpeg/win-x64');
  const binaries = fs.readdirSync(ffmpegDir).filter(n => /\.(exe|dll)$/i.test(n)).sort().map(name => ({
    file: name, sha256: sha(fs.readFileSync(path.join(ffmpegDir, name))),
  }));
  const version = execFileSync(path.join(ffmpegDir, 'ffmpeg.exe'), ['-version'], { encoding: 'utf8', windowsHide: true });
  if (/--enable-(gpl|nonfree)(?:\s|$)/.test(version)) throw new Error('Unexpected GPL/nonfree FFmpeg configuration');
  fs.writeFileSync(path.join(notices, 'FFMPEG-BUILD.txt'), version);
  const lock = fs.readFileSync(path.join(root, 'package-lock.json'));
  fs.writeFileSync(path.join(notices, 'MANIFEST.json'), JSON.stringify({
    scope: 'Installed dependency legal-file superset; not a complete source-distribution certification',
    packageLockSha256: sha(lock), upstreamFiles: entries.map(({ text, ...e }) => e), ffmpegBinaries: binaries,
  }, null, 2) + '\n');
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, 'build', 'eula.txt'));
  console.log(`Preserved ${entries.length} upstream legal files; fingerprinted ${binaries.length} FFmpeg binaries.`);
}
module.exports = generate;
if (require.main === module) generate();
