/**
 * Two browser contexts join the same room code and assert peer presence via PeerJS.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8766;
const ROOM = 'TEST' + Math.floor(Math.random() * 900 + 100);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
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

async function joinAs(page, name) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(dest);
      osc.start();
      const track = dest.stream.getAudioTracks()[0];
      track.enabled = false;
      return dest.stream;
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.fill('#nameInput', name);
  await page.locator('#roomJoinDetails').evaluate((el) => {
    el.open = true;
  });
  await page.fill('#roomInput', ROOM);
  await page.check('input[name="mode"][value="group"]');
  await page.click('#joinBtn');
  await page.waitForFunction(() => window.__speek?.getState()?.connected === true, null, {
    timeout: 25000,
  });
}

async function main() {
  const server = await serve();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  try {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    console.log(`Room code: ${ROOM}`);
    await joinAs(pageA, 'Alice');
    const stateA1 = await pageA.evaluate(() => window.__speek.getState());
    console.log('A online', { isHost: stateA1.isHost, selfId: stateA1.selfId });

    await joinAs(pageB, 'Bob');
    const stateB1 = await pageB.evaluate(() => window.__speek.getState());
    console.log('B online', { isHost: stateB1.isHost, selfId: stateB1.selfId });

    // Wait until each sees the other
    await pageA.waitForFunction(
      () => (window.__speek.getState().peers || []).some((p) => p.name === 'Bob'),
      null,
      { timeout: 20000 }
    );
    await pageB.waitForFunction(
      () => (window.__speek.getState().peers || []).some((p) => p.name === 'Alice'),
      null,
      { timeout: 20000 }
    );

    const finalA = await pageA.evaluate(() => window.__speek.getState());
    const finalB = await pageB.evaluate(() => window.__speek.getState());

    console.log('PASS: mutual presence', {
      A_peers: finalA.peers,
      B_peers: finalB.peers,
      host: finalA.isHost ? 'A' : finalB.isHost ? 'B' : 'none',
    });
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
