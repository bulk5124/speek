/**
 * Resolve PeerJS connection options for Speek.
 *
 * Priority (highest first):
 * 1. URL query: peerHost, peerPort, peerPath, peerSecure, peerKey, peerReset
 * 2. window.SPEEK_PEER_CONFIG (inline config before app.js)
 * 3. localStorage key `speek.peerConfig` (persisted after a successful query apply)
 * 4. Defaults — PeerJS public cloud (GitHub Pages / demo path)
 *
 * Firm / LAN example:
 *   https://192.168.1.20:8443/?peerHost=192.168.1.20&peerPort=8443&peerPath=/peerjs&peerSecure=1
 *   (or same-origin defaults when peerSameOrigin=1)
 */

export const PEER_STORAGE_KEY = 'speek.peerConfig';

export const CLOUD_PEER_DEFAULTS = Object.freeze({
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  key: 'peerjs',
  debug: 1,
});

/**
 * @typedef {object} PeerConfig
 * @property {string} host
 * @property {number} port
 * @property {string} path
 * @property {boolean} secure
 * @property {string} [key]
 * @property {number} [debug]
 */

/**
 * @param {unknown} value
 * @returns {boolean|undefined}
 */
export function parseBool(value) {
  if (value == null || value === '') return undefined;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return undefined;
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number|undefined}
 */
export function parsePort(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
  return Math.floor(n);
}

/**
 * @param {Partial<PeerConfig>|null|undefined} raw
 * @returns {PeerConfig|null}
 */
export function normalizePeerConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  if (!host) return null;
  const pathRaw = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : '/';
  const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
  const port = parsePort(raw.port, raw.secure === false ? 9000 : 443);
  if (port == null) return null;
  const secure = typeof raw.secure === 'boolean' ? raw.secure : port === 443;
  const key = typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : 'peerjs';
  const debug = Number.isFinite(Number(raw.debug)) ? Number(raw.debug) : 1;
  return { host, port, path, secure, key, debug };
}

/**
 * @param {URLSearchParams|Record<string,string>} params
 * @returns {Partial<PeerConfig> & { reset?: boolean, sameOrigin?: boolean }}
 */
export function peerConfigFromSearchParams(params) {
  const get = (k) => {
    if (typeof params.get === 'function') return params.get(k);
    return params[k];
  };
  const reset = parseBool(get('peerReset'));
  const sameOrigin = parseBool(get('peerSameOrigin'));
  const host = get('peerHost') || get('peerjsHost') || '';
  const path = get('peerPath') || get('peerjsPath') || '';
  const key = get('peerKey') || '';
  const portRaw = get('peerPort') || get('peerjsPort');
  const secureRaw = get('peerSecure') || get('peerjsSecure');
  /** @type {Partial<PeerConfig> & { reset?: boolean, sameOrigin?: boolean }} */
  const out = {};
  if (reset) out.reset = true;
  if (sameOrigin) out.sameOrigin = true;
  if (host) out.host = String(host).trim();
  if (path) out.path = String(path).trim();
  if (key) out.key = String(key).trim();
  const port = parsePort(portRaw);
  if (port != null) out.port = port;
  const secure = parseBool(secureRaw);
  if (secure != null) out.secure = secure;
  return out;
}

/**
 * Same-origin PeerServer (serve-lan.mjs): host/port/secure from page location, path /peerjs.
 * @param {{ protocol?: string, hostname?: string, port?: string }} loc
 * @returns {PeerConfig}
 */
export function sameOriginPeerConfig(loc = typeof location !== 'undefined' ? location : {}) {
  const protocol = loc.protocol || 'https:';
  const hostname = loc.hostname || '127.0.0.1';
  const secure = protocol === 'https:';
  let port = parsePort(loc.port);
  if (port == null) port = secure ? 443 : 80;
  return {
    host: hostname,
    port,
    path: '/peerjs',
    secure,
    key: 'peerjs',
    debug: 1,
  };
}

/**
 * @param {object} [opts]
 * @param {string|URLSearchParams|Record<string,string>} [opts.search] - query string or params
 * @param {Partial<PeerConfig>|null} [opts.inline] - window.SPEEK_PEER_CONFIG
 * @param {string|null} [opts.storedJson] - localStorage raw JSON
 * @param {{ protocol?: string, hostname?: string, port?: string }} [opts.location]
 * @param {(key: string, value: string) => void} [opts.persist] - write localStorage
 * @param {(key: string) => void} [opts.clearPersisted]
 * @returns {{ config: PeerConfig, source: string, persisted: boolean }}
 */
export function resolvePeerConfig(opts = {}) {
  const locationLike = opts.location || (typeof location !== 'undefined' ? location : { protocol: 'https:', hostname: '0.peerjs.com', port: '443' });

  let params;
  if (opts.search == null && typeof location !== 'undefined') {
    params = new URLSearchParams(location.search);
  } else if (typeof opts.search === 'string') {
    params = new URLSearchParams(opts.search.startsWith('?') ? opts.search : `?${opts.search}`);
  } else if (opts.search && typeof opts.search.get === 'function') {
    params = opts.search;
  } else {
    params = opts.search || {};
  }

  const fromQuery = peerConfigFromSearchParams(params);

  if (fromQuery.reset) {
    opts.clearPersisted?.(PEER_STORAGE_KEY);
  }

  if (fromQuery.sameOrigin && !fromQuery.host) {
    const config = sameOriginPeerConfig(locationLike);
    const json = JSON.stringify({
      host: config.host,
      port: config.port,
      path: config.path,
      secure: config.secure,
      key: config.key,
    });
    opts.persist?.(PEER_STORAGE_KEY, json);
    return { config, source: 'same-origin', persisted: true };
  }

  const queryPartial = { ...fromQuery };
  delete queryPartial.reset;
  delete queryPartial.sameOrigin;
  const fromQueryNorm = normalizePeerConfig(queryPartial);
  if (fromQueryNorm) {
    const json = JSON.stringify({
      host: fromQueryNorm.host,
      port: fromQueryNorm.port,
      path: fromQueryNorm.path,
      secure: fromQueryNorm.secure,
      key: fromQueryNorm.key,
    });
    opts.persist?.(PEER_STORAGE_KEY, json);
    return { config: fromQueryNorm, source: 'query', persisted: true };
  }

  const inline = normalizePeerConfig(opts.inline ?? (typeof window !== 'undefined' ? window.SPEEK_PEER_CONFIG : null));
  if (inline) {
    return { config: inline, source: 'inline', persisted: false };
  }

  let stored = null;
  if (!fromQuery.reset) {
    if (opts.storedJson != null) {
      try {
        stored = normalizePeerConfig(JSON.parse(opts.storedJson));
      } catch {
        stored = null;
      }
    } else if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(PEER_STORAGE_KEY);
        stored = raw ? normalizePeerConfig(JSON.parse(raw)) : null;
      } catch {
        stored = null;
      }
    }
  }
  if (stored) {
    return { config: stored, source: 'localStorage', persisted: false };
  }

  return {
    config: { ...CLOUD_PEER_DEFAULTS },
    source: 'cloud-default',
    persisted: false,
  };
}

/**
 * Full PeerJS constructor options (includes ICE servers).
 * @param {PeerConfig} config
 * @param {object} [ice]
 */
export function toPeerJsOptions(config, ice) {
  const iceServers = ice?.iceServers || [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  return {
    host: config.host,
    port: config.port,
    path: config.path,
    secure: config.secure,
    key: config.key || 'peerjs',
    debug: config.debug ?? 1,
    config: { iceServers },
  };
}

/**
 * Human-readable label for UI / logs.
 * @param {PeerConfig} config
 */
export function peerConfigLabel(config) {
  const proto = config.secure ? 'wss' : 'ws';
  return `${proto}://${config.host}:${config.port}${config.path}`;
}
