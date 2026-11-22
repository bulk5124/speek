/**
 * Speek LAN PeerServer — signaling only (no media relay).
 * Binds 0.0.0.0 so devices on the same WiFi/LAN can reach it;
 * hosts outside that network cannot (no public exposure required).
 *
 * Usage:
 *   npm start
 *   PORT=9000 PATH=/peerjs HOST=0.0.0.0 npm start
 *   SSL_KEY=./certs/key.pem SSL_CERT=./certs/cert.pem npm start
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerServer } from 'peer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 9000);
const HOST = process.env.HOST || '0.0.0.0';
const PEER_PATH = process.env.PATH_PEER || process.env.PEER_PATH || '/peerjs';
const KEY = process.env.PEER_KEY || 'peerjs';
const SSL_KEY = process.env.SSL_KEY || '';
const SSL_CERT = process.env.SSL_CERT || '';

const opts = {
  port: PORT,
  host: HOST,
  path: PEER_PATH,
  key: KEY,
  allow_discovery: false,
  proxied: false,
};

if (SSL_KEY && SSL_CERT) {
  opts.ssl = {
    key: fs.readFileSync(path.resolve(__dirname, SSL_KEY)),
    cert: fs.readFileSync(path.resolve(__dirname, SSL_CERT)),
  };
}

const server = PeerServer(opts);

server.on('connection', (client) => {
  console.log(`[speek-peerserver] connected: ${client.getId()}`);
});
server.on('disconnect', (client) => {
  console.log(`[speek-peerserver] disconnected: ${client.getId()}`);
});

const proto = opts.ssl ? 'https' : 'http';
console.log(`[speek-peerserver] ${proto}://${HOST}:${PORT}${PEER_PATH}`);
console.log('[speek-peerserver] LAN-only: bind all interfaces; do not publish this port to the internet.');
console.log('[speek-peerserver] Client tip: ?peerHost=<LAN-IP>&peerPort=' + PORT + '&peerPath=' + encodeURIComponent(PEER_PATH) + (opts.ssl ? '&peerSecure=1' : '&peerSecure=0'));
