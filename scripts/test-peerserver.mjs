/**
 * Smoke-test Speek PeerServer HTTP health (path JSON).
 * Starts peerserver/server.mjs briefly, fetches /peerjs, then stops.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PS = path.join(ROOT, 'peerserver');
const PORT = 19090;
const PEER_PATH = '/peerjs';

async function waitFor(url, attempts = 40) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw lastErr;
}

const nodeModules = path.join(PS, 'node_modules', 'peer');
if (!fs.existsSync(nodeModules)) {
  console.log('skip — peerserver deps not installed (cd peerserver && npm install)');
  process.exit(0);
}

const child = spawn(
  process.execPath,
  ['server.mjs'],
  {
    cwd: PS,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PEER_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

let stderr = '';
child.stderr.on('data', (d) => {
  stderr += d.toString();
});
child.stdout.on('data', () => {});

try {
  const res = await waitFor(`http://127.0.0.1:${PORT}${PEER_PATH}`);
  const body = await res.json();
  assert.equal(typeof body.name, 'string');
  assert.match(body.name, /PeerJS/i);
  console.log('ok — peerserver', body.name);
} catch (err) {
  console.error('peerserver smoke failed:', err.message);
  if (stderr) console.error(stderr);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
}
