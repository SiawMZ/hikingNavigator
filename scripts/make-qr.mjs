// Makes a printable QR code (SVG) for each trail.
//
//   npm run qr -- https://your-site.pages.dev
//
// Codes open the trail page with ?s=qr so scans are counted separately from
// other visits. Files go in the qr/ folder.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2]?.replace(/\/$/, '');
if (!base || !/^https:\/\//.test(base)) {
  console.error('Usage: npm run qr -- https://your-site.example   (must start with https://)');
  process.exit(1);
}

const trails = JSON.parse(readFileSync(join(root, 'public', 'trails', 'index.json'), 'utf8')).filter((t) => !t.demo);
if (!trails.length) {
  console.error('No real trails yet (demo trails are skipped). Import one first.');
  process.exit(1);
}

const out = join(root, 'qr');
mkdirSync(out, { recursive: true });
for (const trail of trails) {
  const url = `${base}/t/${trail.id}?s=qr`;
  // Error level H keeps the code readable when the sticker is scratched or muddy.
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H', margin: 4 });
  writeFileSync(join(out, `${trail.id}.svg`), svg);
  console.log(`${trail.id}  ${url}`);
}
