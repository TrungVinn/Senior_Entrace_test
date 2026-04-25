/**
 * Takes screenshots of each dashboard tab using puppeteer-core + local Chrome.
 * Run: node scripts/screenshot.mjs
 */
import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = path.resolve(__dirname, '../docs/screenshots');
const BASE_URL  = 'http://localhost:5173';
const CHROME    = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const TABS = [
  { id: 'EQUITIES',  label: 'tab_equities',   waitMs: 2000 },
  { id: 'CRYPTO',    label: 'tab_crypto',      waitMs: 3000 },
  { id: 'NEWS',      label: 'tab_intelligence',waitMs: 4000 },
  { id: 'OVERVIEW',  label: 'tab_screener',    waitMs: 4000 },
  { id: 'SIMULATOR', label: 'tab_simulator',   waitMs: 4000 },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
});

const page = await browser.newPage();

// Load app once
await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
await new Promise(r => setTimeout(r, 2000));

// Screenshot each tab by clicking the nav button
for (const tab of TABS) {
  // Click the nav item via aria/text — find the button with this tab id
  await page.evaluate((tabId) => {
    // The nav buttons call setActiveTab — find by clicking the button whose onClick sets to tabId.
    // We'll dispatch click on each sidebar button by order based on the navItems array.
    // Simpler: look for the button that contains the right icon or label.
    // Since all buttons are in the sidebar w-16 div, click the nth one.
    const buttons = document.querySelectorAll('div.w-16 button');
    const labels  = ['OVERVIEW', 'EQUITIES', 'CRYPTO', 'NEWS', 'SIMULATOR'];
    const idx     = labels.indexOf(tabId);
    if (idx >= 0 && buttons[idx]) buttons[idx].click();
  }, tab.id);

  await new Promise(r => setTimeout(r, tab.waitMs));
  const outPath = path.join(OUT_DIR, `${tab.label}.png`);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`✓  ${tab.label}.png`);
}

await browser.close();
console.log('\nAll screenshots saved to docs/screenshots/');
