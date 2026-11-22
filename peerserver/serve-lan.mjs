/**
 * One-box Speek LAN host: HTTPS static files + PeerServer on the same port.
 * Phones/PCs on the same WiFi open https://<LAN-IP>:8443/?peerHost=… (or same-origin defaults).
 *
 *   npm run certs
 *   npm run start:lan
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ExpressPeerServer } from 'peer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.resolve(__dirname, '..');
const CERT_DIR = path.join(__dirname, 'certs');

const PORT = Number(process.env.PORT || 8443);
const HOST = process.env.HOST || '0.0.0.0';
const PEER_PATH = process.env.PEER_PATH || '/peerjs';
const PEER_KEY = process.env.PEER_KEY || 'peerjs';
const USE_HTTP = process.env.HTTP === '1' || process.env.HTTP === 'true';

function lanIpv4s() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function loadTls() {
  const keyPath = process.env.SSL_KEY
    ? path.resolve(__dirname, process.env.SSL_KEY)
    : path.join(CERT_DIR, 'key.pem');
  const certPath = process.env.SSL_CERT
    ? path.resolve(__dirname, process.env.SSL_CERT)
    : path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('[speek-lan] Missing TLS certs. Run: npm run certs');
    console.error(`[speek-lan] Expected: ${keyPath} and ${certPath}`);
    process.exit(1);
  }
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

const app = express();
app.disable('x-powered-by');

const server = USE_HTTP ? http.createServer(app) : https.createServer(loadTls(), app);

const peerMiddleware = ExpressPeerServer(server, {
  path: '/',
  key: PEER_KEY,
  allow_discovery: false,
  proxied: false,
});
app.use(PEER_PATH, peerMiddleware);

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'speek-lan', peerPath: PEER_PATH });
});

app.use(express.static(STATIC_ROOT, { extensions: ['html'] }));

server.listen(PORT, HOST, () => {
  const proto = USE_HTTP ? 'http' : 'https';
  const ips = lanIpv4s();
  console.log(`[speek-lan] listening ${proto}://${HOST}:${PORT}`);
  console.log(`[speek-lan] PeerServer path: ${PEER_PATH}`);
  console.log('[speek-lan] Static root:', STATIC_ROOT);
  if (!ips.length) {
    console.log(`[speek-lan] Open locally: ${proto}://127.0.0.1:${PORT}/`);
  } else {
    for (const ip of ips) {
      const q = new URLSearchParams({
        peerHost: ip,
        peerPort: String(PORT),
        peerPath: PEER_PATH,
        peerSecure: USE_HTTP ? '0' : '1',
      });
      console.log(`[speek-lan] Same WiFi URL: ${proto}://${ip}:${PORT}/?${q}`);
    }
  }
  if (!USE_HTTP) {
    console.log('[speek-lan] Self-signed cert: accept the browser warning once per device.');
  }
  console.log('[speek-lan] Do not forward this port to the internet — Speek stays LAN-only.');
});

peerMiddleware.on('connection', (client) => {
  console.log(`[speek-lan] peer connected: ${client.getId()}`);
});
peerMiddleware.on('disconnect', (client) => {
  console.log(`[speek-lan] peer disconnected: ${client.getId()}`);
});
