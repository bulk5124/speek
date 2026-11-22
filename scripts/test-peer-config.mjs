/**
 * Unit tests for peer-config.js (no browser / PeerJS cloud required).
 */
import assert from 'node:assert/strict';
import {
  CLOUD_PEER_DEFAULTS,
  PEER_STORAGE_KEY,
  normalizePeerConfig,
  parseBool,
  peerConfigFromSearchParams,
  peerConfigLabel,
  resolvePeerConfig,
  sameOriginPeerConfig,
  toPeerJsOptions,
} from '../peer-config.js';

assert.equal(parseBool('1'), true);
assert.equal(parseBool('false'), false);
assert.equal(parseBool(''), undefined);

assert.deepEqual(normalizePeerConfig({ host: '192.168.1.5', port: 9000, path: 'peerjs', secure: false }), {
  host: '192.168.1.5',
  port: 9000,
  path: '/peerjs',
  secure: false,
  key: 'peerjs',
  debug: 1,
});

const fromQ = peerConfigFromSearchParams(
  new URLSearchParams('peerHost=10.0.0.2&peerPort=8443&peerPath=/peerjs&peerSecure=1'),
);
assert.equal(fromQ.host, '10.0.0.2');
assert.equal(fromQ.port, 8443);
assert.equal(fromQ.secure, true);

const same = sameOriginPeerConfig({ protocol: 'https:', hostname: '192.168.0.10', port: '8443' });
assert.equal(same.host, '192.168.0.10');
assert.equal(same.port, 8443);
assert.equal(same.path, '/peerjs');
assert.equal(same.secure, true);

let stored = null;
const cloud = resolvePeerConfig({
  search: '',
  location: { protocol: 'https:', hostname: 'example.com', port: '' },
});
assert.equal(cloud.source, 'cloud-default');
assert.equal(cloud.config.host, CLOUD_PEER_DEFAULTS.host);

const query = resolvePeerConfig({
  search: 'peerHost=192.168.1.20&peerPort=9000&peerPath=/peerjs&peerSecure=0',
  persist: (k, v) => {
    assert.equal(k, PEER_STORAGE_KEY);
    stored = v;
  },
  location: { protocol: 'https:', hostname: 'pages.example', port: '' },
});
assert.equal(query.source, 'query');
assert.equal(query.config.host, '192.168.1.20');
assert.equal(query.config.secure, false);
assert.ok(stored);

const fromStore = resolvePeerConfig({
  search: '',
  storedJson: stored,
  location: { protocol: 'https:', hostname: 'pages.example', port: '' },
});
assert.equal(fromStore.source, 'localStorage');
assert.equal(fromStore.config.port, 9000);

let cleared = false;
const reset = resolvePeerConfig({
  search: 'peerReset=1',
  storedJson: stored,
  clearPersisted: () => {
    cleared = true;
  },
  location: { protocol: 'https:', hostname: 'pages.example', port: '' },
});
assert.equal(reset.source, 'cloud-default');
assert.equal(cleared, true);

const sameOrigin = resolvePeerConfig({
  search: 'peerSameOrigin=1',
  persist: () => {},
  location: { protocol: 'https:', hostname: '192.168.1.20', port: '8443' },
});
assert.equal(sameOrigin.source, 'same-origin');
assert.equal(sameOrigin.config.host, '192.168.1.20');

const inline = resolvePeerConfig({
  search: '',
  inline: { host: 'peer.firma.intern', port: 443, path: '/peerjs', secure: true },
});
assert.equal(inline.source, 'inline');

const opts = toPeerJsOptions(query.config);
assert.equal(opts.host, '192.168.1.20');
assert.ok(opts.config.iceServers.length >= 1);
assert.match(peerConfigLabel(query.config), /^ws:\/\/192\.168\.1\.20:9000\/peerjs$/);

console.log('ok — peer-config');
