/**
 * Two browsers: lobby Online → Code anfragen → Annehmen → both in paired 1:1 room.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8768;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
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

async function enterLobby(page, name) {
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
  await page.click('#enterLobbyBtn');
  await page.waitForFunction(() => window.__speek?.lobby?.isConnected?.() === true, null, {
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
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();

    console.log('Shared lobby pairing');
    await enterLobby(pageA, 'Alice');
    await enterLobby(pageB, 'Bob');

    await pageA.waitForFunction(
      () => (window.__speek.getState().lobbyPeers || []).some((p) => p.name === 'Bob'),
      null,
      { timeout: 20000 }
    );
    await pageB.waitForFunction(
      () => (window.__speek.getState().lobbyPeers || []).some((p) => p.name === 'Alice'),
      null,
      { timeout: 20000 }
    );
    console.log('Lobby mutual presence OK');

    // Button injected via speek:lobby-peer-actions
    await pageA.waitForSelector('[data-speek-ask-code]', { timeout: 10000 });
    const bobId = await pageA.evaluate(() => {
      const bob = (window.__speek.getState().lobbyPeers || []).find((p) => p.name === 'Bob');
      return bob?.id || null;
    });
    if (!bobId) throw new Error('Bob lobby id missing on A');

    await pageA.evaluate((id) => window.__speek.requestPair(id, 'Bob'), bobId);

    await pageB.waitForSelector('#pairModal:not(.hidden)', { timeout: 15000 });
    console.log('B received pair modal');
    await pageB.click('#pairApproveBtn');

    await pageA.waitForFunction(() => window.__speek.getState().connected === true, null, {
      timeout: 25000,
    });
    await pageB.waitForFunction(() => window.__speek.getState().connected === true, null, {
      timeout: 25000,
    });

    const finalA = await pageA.evaluate(() => window.__speek.getState());
    const finalB = await pageB.evaluate(() => window.__speek.getState());

    if (!finalA.roomCode || finalA.roomCode.length !== 6) {
      throw new Error(`Expected 6-char room on A, got ${finalA.roomCode}`);
    }
    if (finalA.roomCode !== finalB.roomCode) {
      throw new Error(`Room mismatch A=${finalA.roomCode} B=${finalB.roomCode}`);
    }
    if (finalA.mode !== 'one' || finalB.mode !== 'one') {
      throw new Error('Expected 1:1 mode after pairing');
    }
    if (!finalA.roomExpiresAt || finalA.roomExpiresAt < Date.now()) {
      throw new Error('Missing/expired roomExpiresAt on A');
    }

    await pageA.waitForFunction(
      () => (window.__speek.getState().peers || []).some((p) => p.name === 'Bob'),
      null,
      { timeout: 20000 }
    );

    const afterA = await pageA.evaluate(() => window.__speek.getState());
    const afterB = await pageB.evaluate(() => window.__speek.getState());
    console.log('PASS: pairing → shared safe room', {
      room: finalA.roomCode,
      expiresAt: finalA.roomExpiresAt,
      A_peers: afterA.peers,
      B_peers: afterB.peers,
      lobbyStillUp: !!(finalA.lobbyConnected && finalB.lobbyConnected),
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
