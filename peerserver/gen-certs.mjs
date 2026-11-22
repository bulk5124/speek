/**
 * Generate a self-signed TLS cert for LAN Speek (HTTPS + mic permission).
 * Beginner-friendly: no OpenSSL CLI required (Node crypto).
 */
import { generateKeyPairSync, createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'certs');
fs.mkdirSync(outDir, { recursive: true });

const keyPath = path.join(outDir, 'key.pem');
const certPath = path.join(outDir, 'cert.pem');

function lanIps() {
  const ips = ['127.0.0.1'];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

// Prefer openssl when available (SAN for LAN IPs); else minimal Node keypair + openssl req.
function tryOpenSsl() {
  const ips = lanIps();
  const conf = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = speek.lan

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
DNS.2 = speek.lan
${ips.map((ip, i) => `IP.${i + 1} = ${ip}`).join('\n')}
`;
  const confPath = path.join(outDir, 'openssl.cnf');
  fs.writeFileSync(confPath, conf);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-nodes',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '825',
      '-config',
      confPath,
    ],
    { stdio: 'inherit' },
  );
  return true;
}

function fallbackNode() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  // Without openssl we cannot easily emit a proper X.509 PEM; require openssl for firm path.
  fs.writeFileSync(keyPath, privateKey);
  const fingerprint = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  console.error('[certs] openssl not found — cannot write a usable browser cert.');
  console.error(`[certs] Wrote key only (${fingerprint}). Install openssl and re-run: npm run certs`);
  process.exit(1);
}

try {
  tryOpenSsl();
  console.log('[certs] Wrote', keyPath);
  console.log('[certs] Wrote', certPath);
  console.log('[certs] SANs include:', lanIps().join(', '));
} catch (err) {
  console.warn('[certs] openssl failed:', err.message);
  fallbackNode();
}
