// Generate placeholder PWA icons (replace with branded versions later).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const outDir = resolve('public');
mkdirSync(outDir, { recursive: true });

function makeSvg(size: number): Buffer {
  const fontSize = Math.round(size * 0.45);
  const cy = Math.round(size * 0.62);
  const cornerRadius = Math.round(size * 0.18);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="#171717"/>
    <text x="${size / 2}" y="${cy}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">AI</text>
  </svg>`);
}

async function emit(size: number, file: string, opts: { maskable?: boolean } = {}) {
  const svg = makeSvg(size);
  const buf = await sharp(svg).png().toBuffer();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(outDir, file), buf);
  console.log('Wrote', file, opts.maskable ? '(maskable)' : '');
}

async function main() {
  await emit(192, 'icon-192.png');
  await emit(512, 'icon-512.png');
  await emit(512, 'icon-maskable-512.png', { maskable: true });
  await emit(180, 'apple-touch-icon.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
