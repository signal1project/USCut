const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
module.exports = function verify(outDir) {
  const resources = path.join(outDir, 'resources');
  for (const name of ['LICENSE', ...fs.readdirSync(path.join(root, 'NOTICES')).map(n => `NOTICES/${n}`)]) {
    const source = path.join(root, name);
    if (!fs.statSync(source).isFile()) continue;
    const target = path.join(resources, name);
    if (!fs.existsSync(target) || sha(fs.readFileSync(source)) !== sha(fs.readFileSync(target))) {
      throw new Error(`Missing or stale packaged legal document: ${name}`);
    }
  }
  for (const name of ['Montserrat-OFL.txt', 'PlayfairDisplay-OFL.txt']) {
    const source = path.join(root, 'public/assets/fonts', name);
    const target = path.join(resources, 'assets/fonts', name);
    if (!fs.existsSync(target) || sha(fs.readFileSync(source)) !== sha(fs.readFileSync(target))) throw new Error(`Missing/stale font notice: ${name}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'NOTICES/MANIFEST.json'), 'utf8'));
  for (const binary of manifest.ffmpegBinaries) {
    const target = path.join(resources, 'ffmpeg', binary.file);
    if (!fs.existsSync(target) || sha(fs.readFileSync(target)) !== binary.sha256) throw new Error(`FFmpeg provenance mismatch: ${binary.file}`);
  }
  console.log('Packaged EULA, notices, font licenses and FFmpeg fingerprints verified. This is not legal release clearance.');
};
if (require.main === module) module.exports(process.argv[2]);
