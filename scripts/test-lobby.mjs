/**
 * Two browser contexts enter the shared global lobby and assert Online presence.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8767;
const EXPECTED_LOBBY_ID = 'speeklobbydefault';

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

async function enterLobbyAs(page, name) {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  // Shared lobby: only display name — no Space / Firma field.
  if (await page.$('#spaceInput')) {
    throw new Error('spaceInput must not exist in shared-lobby UI');
  }
  await page.fill('#nameInput', name);
  await page.click('#enterLobbyBtn');
  await page.waitForFunction(() => window.__speek?.lobby?.isConnected?.() === true, null, {
    timeout: 25000,
  });
}

async function main() {
  const server = await serve();
  const browser = await chromium.launch({ headless: true });

  try {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    console.log(`Shared lobby: ${EXPECTED_LOBBY_ID}`);
    await enterLobbyAs(pageA, 'Alice');
    const stateA1 = await pageA.evaluate(() => {
      const s = window.__speek.getState();
      return {
        lobbyId: s.lobbyId,
        spaceId: s.spaceId,
        lobbyConnected: s.lobbyConnected,
        hostId: window.__speek.lobbyPeerId(),
      };
    });
    console.log('A lobby', stateA1);
    if (stateA1.hostId !== EXPECTED_LOBBY_ID) {
      throw new Error(`Expected lobby hub ${EXPECTED_LOBBY_ID}, got ${stateA1.hostId}`);
    }
    if (stateA1.lobbyId !== EXPECTED_LOBBY_ID) {
      throw new Error(`Expected lobbyId ${EXPECTED_LOBBY_ID}, got ${stateA1.lobbyId}`);
    }

    await enterLobbyAs(pageB, 'Bob');

    await pageA.waitForFunction(
      () => (window.__speek.lobby.getPeers() || []).some((p) => p.name === 'Bob'),
      null,
      { timeout: 20000 }
    );
    await pageB.waitForFunction(
      () => (window.__speek.lobby.getPeers() || []).some((p) => p.name === 'Alice'),
      null,
      { timeout: 20000 }
    );

    const heading = await pageA.textContent('#lobbyHeading');
    const subtitle = await pageA.textContent('#lobbySub');
    const actionsSlots = await pageA.$$eval('.peer-actions', (els) => els.length);

    const finalA = await pageA.evaluate(() => ({
      peers: window.__speek.lobby.getPeers(),
      lobbyId: window.__speek.lobby.getLobbyId(),
      space: window.__speek.lobby.getSpaceId(),
      self: window.__speek.lobby.getSelf(),
    }));
    const finalB = await pageB.evaluate(() => ({
      peers: window.__speek.lobby.getPeers(),
      lobbyId: window.__speek.lobby.getLobbyId(),
      space: window.__speek.lobby.getSpaceId(),
    }));

    if (heading?.trim() !== 'Lobby') throw new Error(`Expected Lobby heading, got ${heading}`);
    if (!subtitle?.includes('online')) {
      throw new Error(`Expected lobby subtitle about online, got ${subtitle}`);
    }
    if (actionsSlots < 1) throw new Error('Expected .peer-actions hook slots for pairing');
    if (finalA.lobbyId !== finalB.lobbyId || finalA.lobbyId !== EXPECTED_LOBBY_ID) {
      throw new Error(`Lobby id mismatch A=${finalA.lobbyId} B=${finalB.lobbyId}`);
    }

    console.log('PASS: shared lobby mutual presence', {
      A_peers: finalA.peers,
      B_peers: finalB.peers,
      lobbyId: finalA.lobbyId,
      actionsSlots,
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
