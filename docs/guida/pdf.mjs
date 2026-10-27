// Stampa la guida in PDF con Chromium: node docs/guida/pdf.mjs  -> docs/Guida-gestionale-fiorista.pdf
// Variabili: PW (cartella di playwright-core), CHROME, eventualmente LD_LIBRARY_PATH (come per le prove).
import path from 'node:path';
import { createRequire } from 'node:module';
const QUI = path.dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const pg = await browser.newPage();
await pg.goto('file://' + path.join(QUI, 'guida.html'), { waitUntil: 'load' });
await pg.pdf({
  path: path.join(QUI, '..', 'Guida-gestionale-fiorista.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font:8px system-ui,sans-serif;color:#888;padding:0 17mm;display:flex;justify-content:space-between"><span>Il gestionale del fiorista · Guida all\'uso</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log('PDF creato');
