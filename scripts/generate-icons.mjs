// Renders public/icons/icon.svg into the PNG icons + iOS splash screens.
// Usage: npm run icons   (needs Playwright + Chromium: `npx playwright install chromium`)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8');
const svgUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// iPhone portrait splash sizes (device px) — keep in sync with index.html.
export const SPLASHES = [
  [640, 1136], [750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556],
  [1206, 2622], [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868],
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();

async function render(html, width, height, out) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0">${html}</body></html>`);
  await page.screenshot({ path: out, omitBackground: false });
  console.log('wrote', out);
}

const icon = (size, pad = 0) =>
  `<div style="width:${size}px;height:${size}px;background:#0b0d10;display:flex;align-items:center;justify-content:center">
     <img src="${svgUri}" style="width:${size - pad * 2}px;height:${size - pad * 2}px"/></div>`;

mkdirSync(join(root, 'public/icons'), { recursive: true });
mkdirSync(join(root, 'public/splash'), { recursive: true });
await render(icon(192), 192, 192, join(root, 'public/icons/icon-192.png'));
await render(icon(512), 512, 512, join(root, 'public/icons/icon-512.png'));
await render(icon(512, 56), 512, 512, join(root, 'public/icons/icon-maskable-512.png'));
await render(icon(180), 180, 180, join(root, 'public/icons/apple-touch-icon.png'));
await render(icon(64), 64, 64, join(root, 'public/icons/favicon-64.png'));

for (const [w, h] of SPLASHES) {
  const logo = Math.round(w * 0.28);
  const html = `<div style="width:${w}px;height:${h}px;background:#0b0d10;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(w * 0.05)}px;font-family:-apple-system,system-ui,sans-serif">
    <img src="${svgUri}" style="width:${logo}px;height:${logo}px;border-radius:${Math.round(logo * 0.22)}px"/>
    <div style="color:#e8ecf1;font-size:${Math.round(w * 0.06)}px;font-weight:700;letter-spacing:-0.02em">Fitness OS</div></div>`;
  await render(html, w, h, join(root, `public/splash/splash-${w}x${h}.png`));
}

await browser.close();
