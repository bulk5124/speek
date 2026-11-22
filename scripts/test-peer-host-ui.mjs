/**
 * Assert Speek page applies ?peerHost=… into window.__speek peer config (no live PeerServer needed).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8767;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'playwright'))) {
    console.log('skip — playwright not installed');
    return;
  }
  const server = await serve();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const q = 'peerHost=10.9.8.7&peerPort=9000&peerPath=/peerjs&peerSecure=0';
    await page.goto(`http://127.0.0.1:${PORT}/?${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__speek?.peerConfig, null, { timeout: 10000 });
    const cfg = await page.evaluate(() => window.__speek.peerConfig());
    if (cfg.host !== '10.9.8.7' || cfg.port !== 9000 || cfg.path !== '/peerjs' || cfg.secure !== false) {
      throw new Error(`unexpected peerConfig: ${JSON.stringify(cfg)}`);
    }
    if (cfg.source !== 'query') throw new Error(`expected source query, got ${cfg.source}`);
    const stored = await page.evaluate(() => localStorage.getItem('speek.peerConfig'));
    if (!stored || !stored.includes('10.9.8.7')) throw new Error('localStorage not persisted');
    console.log('ok — peer-host-ui');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
