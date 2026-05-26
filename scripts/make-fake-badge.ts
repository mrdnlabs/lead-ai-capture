// Generate a fake but realistic name-badge PNG so vision extraction has
// real text to work with.
import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const outDir = resolve('tests/fixtures/badges');
mkdirSync(outDir, { recursive: true });

const svg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="700" height="450" viewBox="0 0 700 450">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f3f4f6"/>
    </linearGradient>
  </defs>
  <rect width="700" height="450" fill="url(#bg)" stroke="#d1d5db" stroke-width="2"/>
  <rect x="0" y="0" width="700" height="70" fill="#0ea5e9"/>
  <text x="350" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" font-weight="700" fill="#ffffff" letter-spacing="2">DEVCON 2026</text>
  <text x="40" y="160" font-family="Arial,sans-serif" font-size="58" font-weight="800" fill="#111827">Sarah Chen</text>
  <text x="40" y="220" font-family="Arial,sans-serif" font-size="32" font-weight="500" fill="#374151">VP of Engineering</text>
  <text x="40" y="280" font-family="Arial,sans-serif" font-size="38" font-weight="700" fill="#0ea5e9">Acme Robotics</text>
  <text x="40" y="350" font-family="Arial,sans-serif" font-size="22" font-weight="400" fill="#6b7280">sarah.chen@acmerobotics.io</text>
  <text x="40" y="385" font-family="Arial,sans-serif" font-size="22" font-weight="400" fill="#6b7280">+1 (415) 555-0182</text>
  <text x="660" y="430" text-anchor="end" font-family="Arial,sans-serif" font-size="14" fill="#9ca3af">Attendee</text>
</svg>
`);

async function main() {
  const png = await sharp(svg).png().toBuffer();
  const outPath = resolve(outDir, 'fake-badge-sarah-chen.png');
  writeFileSync(outPath, png);
  console.log('Wrote:', outPath, '(' + png.length + ' bytes)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
