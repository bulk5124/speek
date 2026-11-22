/**
 * Speek hosted — shared global lobby + room-code PTT over PeerJS cloud + WebRTC media (DTLS-SRTP).
 * Lobby: single well-known PeerJS id `speeklobbydefault` (everyone in one Online list).
 * Voice: PeerJS DataConnections for presence; MediaConnections for P2P audio.
 * PeerJS room host-ID prefix `scv1` is protocol-stable — keep for room compatibility.
 *
 * Safe-code pairing (`pairing.js`):
 * - Injects „Code anfragen“ via `speek:lobby-peer-actions`
 * - PeerJS DataConnection protocol: pair-request / pair-approve / pair-deny
 * - 6-char room codes, ~10 min TTL, auto-join 1:1
 */

import { createPairingController, PAIR_TTL_MS } from './pairing.js';
import { generateRoomCode } from './room-code.js';

const $ = (id) => document.getElementById(id);

const els = {
  lobbyJoinPanel: $('lobbyJoinPanel'),
  lobbyPanel: $('lobbyPanel'),
  joinPanel: $('joinPanel'),
  sessionPanel: $('sessionPanel'),
  nameInput: $('nameInput'),
  enterLobbyBtn: $('enterLobbyBtn'),
  lobbyJoinHint: $('lobbyJoinHint'),
  lobbyYouName: $('lobbyYouName'),
  lobbyStatus: $('lobbyStatus'),
  lobbyHeading: $('lobbyHeading'),
  lobbyPeerCount: $('lobbyPeerCount'),
  lobbyPeerList: $('lobbyPeerList'),
  emptyLobby: $('emptyLobby'),
  leaveLobbyBtn: $('leaveLobbyBtn'),
  roomJoinDetails: $('roomJoinDetails'),
  lobbyRoomDetails: $('lobbyRoomDetails'),
  openRoomFromLobbyBtn: $('openRoomFromLobbyBtn'),
  roomInput: $('roomInput'),
  genRoomBtn: $('genRoomBtn'),
  joinBtn: $('joinBtn'),
  joinHint: $('joinHint'),
  youName: $('youName'),
  roomLabel: $('roomLabel'),
  modeChip: $('modeChip'),
  connStatus: $('connStatus'),
  peerList: $('peerList'),
  peerCount: $('peerCount'),
  emptyPeers: $('emptyPeers'),
  peersHeading: $('peersHeading'),
  talkDock: $('talkDock'),
  talkTarget: $('talkTarget'),
  pttBtn: $('pttBtn'),
  leaveTalkBtn: $('leaveTalkBtn'),
  leaveRoomBtn: $('leaveRoomBtn'),
  talkHint: $('talkHint'),
  sessionGuide: $('sessionGuide'),
  pairHint: $('pairHint'),
  pairModal: $('pairModal'),
  pairModalBackdrop: $('pairModalBackdrop'),
  pairModalTitle: $('pairModalTitle'),
  pairModalBody: $('pairModalBody'),
  pairApproveBtn: $('pairApproveBtn'),
  pairDenyBtn: $('pairDenyBtn'),
};

const PEER_OPTS = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};

const AVATAR_COLORS = ['#0b6e6e', '#2a5f8f', '#8a4b2a', '#5a4a8f', '#2f6b6b', '#6b3a4a'];
/** Single shared lobby for everyone (PeerJS hub id). */
const SHARED_LOBBY_ID = 'speeklobbydefault';
const LOBBY_HEARTBEAT_MS = 12000;

const state = {
  mode: 'one', // 'one' | 'group'
  roomCode: '',
  /** Optional expiry for paired safe-codes (ms epoch); null = no limit */
  roomExpiresAt: null,
  displayName: '',
  peer: null,
  selfId: null,
  isHost: false,
  hostId: '',
  /** @type {Map<string, {id:string,name:string,device:string,_remoteTalking?:boolean}>} */
  peers: new Map(),
  /** @type {Map<string, import('peerjs').DataConnection>} */
  dataCons: new Map(),
  /** @type {Map<string, import('peerjs').MediaConnection>} */
  mediaCalls: new Map(),
  /** @type {Map<string, HTMLAudioElement>} */
  audios: new Map(),
  localStream: null,
  localTrack: null,
  activePeerId: null,
  pttDown: false,
  destroyed: false,
};

/** @type {ReturnType<typeof createPairingController>|null} */
let pairing = null;

/** Shared global lobby presence (separate PeerJS session from voice rooms). */
const lobby = {
  spaceId: '',
  displayName: '',
  peer: null,
  selfId: null,
  isHost: false,
  hostId: '',
  /** @type {Map<string, {id:string,name:string,device:string,status:string,updatedAt:number}>} */
  peers: new Map(),
  /** @type {Map<string, import('peerjs').DataConnection>} */
  dataCons: new Map(),
  heartbeatTimer: null,
  destroyed: false,
  /** @type {'online'|'busy'} */
  status: 'online',
};

/** @type {Map<string, Set<Function>>} */
const lobbyListeners = new Map();

function normalizeRoom(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function hostPeerId(roomCode) {
  // PeerJS IDs: keep alphanumeric; prefix avoids collisions with other apps.
  return `scv1${roomCode.toLowerCase()}`;
}

/** Well-known shared lobby hub id (PeerJS alphanumeric-safe). */
function lobbyPeerId() {
  return SHARED_LOBBY_ID;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || '')
    .join('')
    .toUpperCase();
}

function colorFor(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[n];
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(text, bad = false) {
  els.connStatus.textContent = text;
  els.connStatus.classList.toggle('bad', bad);
}

function setLobbyStatus(text, bad = false) {
  els.lobbyStatus.textContent = text;
  els.lobbyStatus.classList.toggle('bad', bad);
}

function savedName() {
  try {
    return localStorage.getItem('speek-name') || localStorage.getItem('speedchat-name') || '';
  } catch {
    return '';
  }
}

function saveName(name) {
  try {
    localStorage.setItem('speek-name', name);
  } catch {
    /* ignore */
  }
}

function savedRoom() {
  try {
    return localStorage.getItem('speek-room') || localStorage.getItem('speedchat-room') || '';
  } catch {
    return '';
  }
}

function saveRoom(code) {
  try {
    localStorage.setItem('speek-room', code);
  } catch {
    /* ignore */
  }
}

function saveRoomExpiry(code, expiresAt) {
  try {
    if (!expiresAt) {
      localStorage.removeItem('speek-room-expires');
      return;
    }
    localStorage.setItem(
      'speek-room-expires',
      JSON.stringify({ code: normalizeRoom(code), expiresAt: Number(expiresAt) })
    );
  } catch {
    /* ignore */
  }
}

function loadRoomExpiry(code) {
  try {
    const raw = localStorage.getItem('speek-room-expires');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || normalizeRoom(data.code) !== normalizeRoom(code)) return null;
    return Number(data.expiresAt) || null;
  } catch {
    return null;
  }
}

function clearRoomExpiry() {
  state.roomExpiresAt = null;
  saveRoomExpiry('', null);
}

function selectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el && el.value === 'group' ? 'group' : 'one';
}

function isSecureEnough() {
  return window.isSecureContext;
}

async function ensureMic() {
  if (state.localStream) return state.localStream;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  const track = stream.getAudioTracks()[0];
  track.enabled = false;
  state.localStream = stream;
  state.localTrack = track;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPtt(false);
  });
  return stream;
}

function selfMeta() {
  return {
    id: state.selfId,
    name: state.displayName,
    device: deviceLabel(),
  };
}

function lobbySelfMeta() {
  return {
    id: lobby.selfId,
    name: lobby.displayName,
    device: deviceLabel(),
    status: lobby.status,
  };
}

function statusLabel(status) {
  return status === 'busy' ? 'Im Gespräch' : 'Online';
}

function emitLobby(eventName, detail) {
  const handlers = lobbyListeners.get(eventName);
  if (handlers) {
    for (const fn of handlers) {
      try {
        fn(detail);
      } catch (err) {
        console.warn('lobby listener error', err);
      }
    }
  }
  document.dispatchEvent(new CustomEvent(`speek:${eventName}`, { detail }));
}

function onLobbyEvent(eventName, handler) {
  if (typeof handler !== 'function') return () => {};
  if (!lobbyListeners.has(eventName)) lobbyListeners.set(eventName, new Set());
  lobbyListeners.get(eventName).add(handler);
  return () => lobbyListeners.get(eventName)?.delete(handler);
}

function broadcast(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const [id, conn] of state.dataCons) {
    if (exceptId && id === exceptId) continue;
    if (conn.open) conn.send(raw);
  }
}

function sendTo(peerId, msg) {
  const conn = state.dataCons.get(peerId);
  if (conn && conn.open) conn.send(JSON.stringify(msg));
}

function lobbyBroadcast(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const [id, conn] of lobby.dataCons) {
    if (exceptId && id === exceptId) continue;
    if (conn.open) conn.send(raw);
  }
}

function lobbySendTo(peerId, msg) {
  const conn = lobby.dataCons.get(peerId);
  if (conn && conn.open) conn.send(JSON.stringify(msg));
}

function attachDataConn(conn, remoteHintId) {
  const peerId = conn.peer || remoteHintId;
  state.dataCons.set(peerId, conn);

  conn.on('open', () => {
    conn.send(JSON.stringify({ type: 'hello', peer: selfMeta() }));
    if (state.isHost) {
      pushPeerList();
    }
  });

  conn.on('data', (data) => {
    let msg = data;
    if (typeof data === 'string') {
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
    }
    onPresence(msg, conn.peer);
  });

  conn.on('close', () => {
    onPeerGone(conn.peer);
  });

  conn.on('error', () => {
    /* closed elsewhere */
  });
}

function attachLobbyDataConn(conn, remoteHintId) {
  const peerId = conn.peer || remoteHintId;
  lobby.dataCons.set(peerId, conn);

  conn.on('open', () => {
    conn.send(JSON.stringify({ type: 'lobby-hello', peer: lobbySelfMeta() }));
    if (lobby.isHost) pushLobbyPeerList();
    // Pairing listens on the same DataConnection for pair-* messages.
    pairing?.wireConn(conn);
  });

  conn.on('data', (data) => {
    let msg = data;
    if (typeof data === 'string') {
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
    }
    onLobbyPresence(msg, conn.peer);
  });

  conn.on('close', () => {
    onLobbyPeerGone(conn.peer);
  });

  conn.on('error', () => {
    /* closed elsewhere */
  });
}

/** Open or reuse a lobby DataConnection to a peer (for pairing signaling). */
async function connectLobbyPeer(peerId) {
  if (!lobby.peer) throw new Error('Lobby nicht verbunden');
  if (!peerId || peerId === lobby.selfId) throw new Error('Ungültiger Peer');

  const existing = lobby.dataCons.get(peerId);
  if (existing?.open) {
    pairing?.wireConn(existing);
    return existing;
  }

  if (existing) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Peer-Verbindung Timeout')), 10000);
      existing.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      existing.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    pairing?.wireConn(existing);
    return existing;
  }

  const conn = lobby.peer.connect(peerId, { reliable: true });
  attachLobbyDataConn(conn, peerId);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Peer nicht erreichbar')), 12000);
    conn.on('open', () => {
      clearTimeout(t);
      resolve();
    });
    conn.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
  pairing?.wireConn(conn);
  return conn;
}

function onPresence(msg, fromId) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'hello': {
      if (msg.peer && msg.peer.id) {
        state.peers.set(msg.peer.id, { ...msg.peer, _remoteTalking: false });
        renderPeers();
        if (state.isHost) pushPeerList();
        if (state.mode === 'group') maybeCall(msg.peer.id);
      }
      break;
    }
    case 'peers': {
      if (!Array.isArray(msg.peers)) break;
      const next = new Map();
      for (const p of msg.peers) {
        if (!p || !p.id || p.id === state.selfId) continue;
        const prev = state.peers.get(p.id);
        next.set(p.id, { ...p, _remoteTalking: prev?._remoteTalking || false });
        ensureDataTo(p.id);
        if (state.mode === 'group') maybeCall(p.id);
      }
      for (const id of state.peers.keys()) {
        if (!next.has(id)) teardownMedia(id);
      }
      state.peers = next;
      renderPeers();
      break;
    }
    case 'peer-left': {
      if (msg.id) onPeerGone(msg.id);
      break;
    }
    case 'ptt-state': {
      const peer = state.peers.get(fromId);
      if (!peer) break;
      const towardMe = !msg.to || msg.to === state.selfId;
      peer._remoteTalking = !!(msg.active && towardMe);
      renderPeers();
      if (state.mode === 'one' && state.activePeerId === fromId) {
        els.talkHint.textContent = peer._remoteTalking ? `${peer.name} spricht…` : '';
      } else if (state.mode === 'group' && peer._remoteTalking) {
        els.talkHint.textContent = `${peer.name} spricht…`;
      } else if (state.mode === 'group' && !peer._remoteTalking) {
        const anyone = [...state.peers.values()].some((p) => p._remoteTalking);
        if (!anyone && !state.pttDown) els.talkHint.textContent = '';
      }
      break;
    }
    case 'relay': {
      // Host relays presence to others
      if (state.isHost && msg.payload) {
        broadcast({ ...msg.payload, _via: fromId }, fromId);
        if (msg.payload.type === 'ptt-state') {
          onPresence(msg.payload, fromId);
        }
      }
      break;
    }
    default:
      break;
  }
}

function onLobbyPresence(msg, fromId) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'lobby-hello':
    case 'lobby-ping': {
      if (msg.peer && msg.peer.id && msg.peer.id !== lobby.selfId) {
        lobby.peers.set(msg.peer.id, {
          id: msg.peer.id,
          name: msg.peer.name || 'Gast',
          device: msg.peer.device || 'Browser',
          status: msg.peer.status === 'busy' ? 'busy' : 'online',
          updatedAt: Date.now(),
        });
        renderLobbyPeers();
        if (lobby.isHost) pushLobbyPeerList();
      }
      break;
    }
    case 'lobby-peers': {
      if (!Array.isArray(msg.peers)) break;
      const next = new Map();
      for (const p of msg.peers) {
        if (!p || !p.id || p.id === lobby.selfId) continue;
        next.set(p.id, {
          id: p.id,
          name: p.name || 'Gast',
          device: p.device || 'Browser',
          status: p.status === 'busy' ? 'busy' : 'online',
          updatedAt: Date.now(),
        });
        ensureLobbyDataTo(p.id);
      }
      lobby.peers = next;
      renderLobbyPeers();
      break;
    }
    case 'lobby-peer-left': {
      if (msg.id) onLobbyPeerGone(msg.id);
      break;
    }
    case 'lobby-relay': {
      if (lobby.isHost && msg.payload) {
        lobbyBroadcast({ ...msg.payload, _via: fromId }, fromId);
        if (msg.payload.type === 'lobby-hello' || msg.payload.type === 'lobby-ping') {
          onLobbyPresence(msg.payload, fromId);
        }
      }
      break;
    }
    default:
      break;
  }
}

function pushPeerList() {
  if (!state.isHost) return;
  const peers = [selfMeta(), ...state.peers.values()].map(({ id, name, device }) => ({
    id,
    name,
    device,
  }));
  broadcast({ type: 'peers', peers });
}

function pushLobbyPeerList() {
  if (!lobby.isHost) return;
  const peers = [lobbySelfMeta(), ...lobby.peers.values()].map(({ id, name, device, status }) => ({
    id,
    name,
    device,
    status: status === 'busy' ? 'busy' : 'online',
  }));
  lobbyBroadcast({ type: 'lobby-peers', peers });
}

function ensureDataTo(peerId) {
  if (!state.peer || peerId === state.selfId) return;
  if (state.dataCons.has(peerId)) return;
  // Guests connect to host only for presence; mesh data optional for ptt to host.
  // Host already has incoming connections. Guest↔guest: open data if we are lexicographically lower.
  if (!state.isHost && peerId !== state.hostId) {
    if (state.selfId < peerId) {
      const conn = state.peer.connect(peerId, { reliable: true });
      attachDataConn(conn, peerId);
    }
    return;
  }
  if (!state.isHost && peerId === state.hostId) {
    // already connected on join
    return;
  }
}

function ensureLobbyDataTo(peerId) {
  if (!lobby.peer || peerId === lobby.selfId) return;
  if (lobby.dataCons.has(peerId)) return;
  if (!lobby.isHost && peerId !== lobby.hostId) {
    if (lobby.selfId < peerId) {
      const conn = lobby.peer.connect(peerId, { reliable: true });
      attachLobbyDataConn(conn, peerId);
    }
    return;
  }
}

function onPeerGone(peerId) {
  if (!peerId) return;
  state.peers.delete(peerId);
  const conn = state.dataCons.get(peerId);
  if (conn) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
    state.dataCons.delete(peerId);
  }
  teardownMedia(peerId);
  if (state.activePeerId === peerId) leaveTalk();
  renderPeers();
  if (state.isHost) {
    broadcast({ type: 'peer-left', id: peerId });
    pushPeerList();
  }
}

function onLobbyPeerGone(peerId) {
  if (!peerId) return;
  lobby.peers.delete(peerId);
  const conn = lobby.dataCons.get(peerId);
  if (conn) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
    lobby.dataCons.delete(peerId);
  }
  renderLobbyPeers();
  if (lobby.isHost) {
    lobbyBroadcast({ type: 'lobby-peer-left', id: peerId });
    pushLobbyPeerList();
  }
}

function teardownMedia(peerId) {
  const call = state.mediaCalls.get(peerId);
  if (call) {
    try {
      call.close();
    } catch {
      /* ignore */
    }
    state.mediaCalls.delete(peerId);
  }
  const audio = state.audios.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    state.audios.delete(peerId);
  }
}

async function maybeCall(peerId) {
  if (!state.peer || !peerId || peerId === state.selfId) return;
  if (state.mediaCalls.has(peerId)) return;
  // Only initiator with lower id places the call (glare avoidance).
  if (state.selfId > peerId) return;
  await ensureMic();
  const call = state.peer.call(peerId, state.localStream, {
    metadata: { from: state.selfId, name: state.displayName },
  });
  wireCall(call, peerId);
}

function wireCall(call, peerId) {
  if (!call) return;
  state.mediaCalls.set(peerId, call);

  call.on('stream', (remoteStream) => {
    let audio = state.audios.get(peerId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.playsInline = true;
      audio.setAttribute('playsinline', '');
      document.body.appendChild(audio);
      state.audios.set(peerId, audio);
    }
    audio.srcObject = remoteStream;
    audio.play().catch(() => {
      els.talkHint.textContent = 'Einmal tippen für Audio.';
    });
  });

  call.on('close', () => {
    state.mediaCalls.delete(peerId);
    const audio = state.audios.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      state.audios.delete(peerId);
    }
  });

  call.on('error', () => {
    state.mediaCalls.delete(peerId);
  });
}

function answerIncoming(call) {
  const peerId = call.peer;
  ensureMic()
    .then(() => {
      call.answer(state.localStream);
      wireCall(call, peerId);
    })
    .catch((err) => {
      console.error(err);
      try {
        call.close();
      } catch {
        /* ignore */
      }
    });
}

function renderPeers() {
  const peers = [...state.peers.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  els.peerCount.textContent = String(peers.length);
  els.emptyPeers.classList.toggle('hidden', peers.length > 0);
  els.peerList.innerHTML = '';

  const clickable = state.mode === 'one';
  els.peersHeading.textContent = clickable ? 'Partner wählen' : 'Im Raum';

  for (const peer of peers) {
    const li = document.createElement('li');
    li.dataset.id = peer.id;
    if (!clickable) li.classList.add('readonly');
    if (peer.id === state.activePeerId) li.classList.add('active');
    if (peer._remoteTalking) li.classList.add('remote-talking');
    if (clickable) li.tabIndex = 0;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = colorFor(peer.id);
    avatar.textContent = initials(peer.name);

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    meta.innerHTML = `<strong>${escapeHtml(peer.name)}</strong><span>${escapeHtml(peer.device || 'Browser')}</span>`;

    li.append(avatar, meta);
    if (peer._remoteTalking) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Spricht';
      li.append(badge);
    }

    if (clickable) {
      li.addEventListener('click', () => selectPeer(peer.id));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectPeer(peer.id);
        }
      });
    }

    els.peerList.append(li);
  }

  if (state.mode === 'group' && peers.length > 0) {
    els.talkDock.classList.remove('hidden');
    els.talkTarget.innerHTML = `Gruppe · <strong>${peers.length}</strong>`;
    els.leaveTalkBtn.classList.add('hidden');
  }
}

function renderLobbyPeers() {
  const peers = [...lobby.peers.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  els.lobbyPeerCount.textContent = String(peers.length);
  els.emptyLobby.classList.toggle('hidden', peers.length > 0);
  els.lobbyPeerList.innerHTML = '';

  for (const peer of peers) {
    const li = document.createElement('li');
    li.classList.add('readonly');
    li.dataset.peerId = peer.id;
    li.dataset.status = peer.status || 'online';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.background = colorFor(peer.id);
    avatar.textContent = initials(peer.name);

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    meta.innerHTML = `<strong>${escapeHtml(peer.name)}</strong><span>${escapeHtml(peer.device || 'Browser')}</span>`;

    const statusEl = document.createElement('span');
    statusEl.className = `peer-status${peer.status === 'busy' ? ' busy' : ''}`;
    statusEl.textContent = statusLabel(peer.status);

    // Slot for pairing PR: inject "Code anfragen" into .peer-actions
    const actions = document.createElement('div');
    actions.className = 'peer-actions';
    actions.dataset.peerId = peer.id;

    li.append(avatar, meta, statusEl, actions);
    els.lobbyPeerList.append(li);

    const peerPayload = {
      id: peer.id,
      name: peer.name,
      device: peer.device,
      status: peer.status || 'online',
    };
    emitLobby('lobby-peer-actions', {
      peer: peerPayload,
      actionsEl: actions,
      spaceId: lobby.spaceId,
    });
  }

  emitLobby('lobby-peers-changed', {
    peers: peers.map(({ id, name, device, status }) => ({
      id,
      name,
      device,
      status: status || 'online',
    })),
    spaceId: lobby.spaceId,
    self: lobby.selfId ? lobbySelfMeta() : null,
  });
}

async function selectPeer(peerId) {
  if (state.mode !== 'one') return;
  if (!state.peers.has(peerId)) return;

  // Tear down other 1:1 media so only the selected peer gets TX when unmuted.
  for (const id of [...state.mediaCalls.keys()]) {
    if (id !== peerId) teardownMedia(id);
  }

  state.activePeerId = peerId;
  const peer = state.peers.get(peerId);
  els.talkTarget.innerHTML = `<strong>${escapeHtml(peer.name)}</strong>`;
  els.talkDock.classList.remove('hidden');
  els.leaveTalkBtn.classList.remove('hidden');
  els.talkHint.textContent = 'Verbinde…';
  renderPeers();

  try {
    await ensureMic();
    if (!state.mediaCalls.has(peerId)) {
      // Force call regardless of id order for intentional 1:1 pick.
      if (state.selfId < peerId || !state.mediaCalls.has(peerId)) {
        const existing = state.mediaCalls.get(peerId);
        if (!existing) {
          const call = state.peer.call(peerId, state.localStream, {
            metadata: { from: state.selfId, name: state.displayName },
          });
          wireCall(call, peerId);
        }
      }
    }
    els.talkHint.textContent = '';
  } catch (err) {
    console.error(err);
    els.talkHint.textContent = `Fehler: ${err.message || err}`;
  }
}

function leaveTalk() {
  setPtt(false);
  state.activePeerId = null;
  if (state.mode === 'one') {
    els.talkDock.classList.add('hidden');
    // Keep media optional; close active ones to free mic paths
    for (const id of [...state.mediaCalls.keys()]) teardownMedia(id);
  }
  els.talkHint.textContent = '';
  renderPeers();
}

function emitPttState(active) {
  const payload = {
    type: 'ptt-state',
    active,
    to: state.mode === 'one' ? state.activePeerId : null,
  };
  if (state.isHost) {
    broadcast(payload);
  } else {
    // Send to host for relay + direct to mesh peers
    sendTo(state.hostId, { type: 'relay', payload });
    broadcast(payload);
  }
}

function setPtt(down) {
  if (!state.localTrack) return;
  if (state.mode === 'one' && !state.activePeerId && down) return;
  if (state.mode === 'group' && state.peers.size === 0 && down) return;
  if (state.pttDown === down) return;

  state.pttDown = down;
  state.localTrack.enabled = down;
  els.pttBtn.setAttribute('aria-pressed', down ? 'true' : 'false');
  els.pttBtn.querySelector('.ptt-label').textContent = down ? 'Du speekst…' : 'Halten & speeken';
  emitPttState(down);

  if (down) {
    const targets =
      state.mode === 'one' && state.activePeerId
        ? [state.activePeerId]
        : [...state.mediaCalls.keys()];
    for (const id of targets) {
      const audio = state.audios.get(id);
      if (audio) audio.play().catch(() => {});
    }
  }
}

function bindPtt() {
  const btn = els.pttBtn;
  const onDown = (e) => {
    e.preventDefault();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setPtt(true);
  };
  const onUp = (e) => {
    e.preventDefault();
    setPtt(false);
  };
  btn.addEventListener('pointerdown', onDown);
  btn.addEventListener('pointerup', onUp);
  btn.addEventListener('pointercancel', onUp);
  btn.addEventListener('lostpointercapture', () => setPtt(false));

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (state.mode === 'one' && !state.activePeerId) return;
    if (els.sessionPanel.classList.contains('hidden')) return;
    e.preventDefault();
    setPtt(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    setPtt(false);
  });
  window.addEventListener('blur', () => setPtt(false));
}

function waitPeerOpen(peer) {
  return new Promise((resolve, reject) => {
    const onOpen = (id) => {
      cleanup();
      resolve(id);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      peer.off('open', onOpen);
      peer.off('error', onError);
    };
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

async function createAsHostOrGuest(roomCode) {
  const hostId = hostPeerId(roomCode);
  state.hostId = hostId;

  // Try claim host id
  const hostTry = new Peer(hostId, PEER_OPTS);
  try {
    const id = await waitPeerOpen(hostTry);
    state.peer = hostTry;
    state.selfId = id;
    state.isHost = true;
    return;
  } catch (err) {
    try {
      hostTry.destroy();
    } catch {
      /* ignore */
    }
    if (!err || (err.type !== 'unavailable-id' && err.type !== 'peer-unavailable')) {
      // unavailable-id is expected when room exists; other errors may still allow guest join
      if (err && err.type && err.type !== 'unavailable-id') {
        console.warn('Host claim failed, joining as guest', err.type || err);
      }
    }
  }

  const guest = new Peer(PEER_OPTS);
  const id = await waitPeerOpen(guest);
  state.peer = guest;
  state.selfId = id;
  state.isHost = false;

  const conn = guest.connect(hostId, { reliable: true });
  attachDataConn(conn, hostId);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Host nicht erreichbar.')), 12000);
    conn.on('open', () => {
      clearTimeout(t);
      resolve();
    });
    conn.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function createLobbyHostOrGuest() {
  const hostId = lobbyPeerId();
  lobby.hostId = hostId;
  lobby.spaceId = SHARED_LOBBY_ID;

  const hostTry = new Peer(hostId, PEER_OPTS);
  try {
    const id = await waitPeerOpen(hostTry);
    lobby.peer = hostTry;
    lobby.selfId = id;
    lobby.isHost = true;
    return;
  } catch (err) {
    try {
      hostTry.destroy();
    } catch {
      /* ignore */
    }
    if (err && err.type && err.type !== 'unavailable-id' && err.type !== 'peer-unavailable') {
      console.warn('Lobby host claim failed, joining as guest', err.type || err);
    }
  }

  const guest = new Peer(PEER_OPTS);
  const id = await waitPeerOpen(guest);
  lobby.peer = guest;
  lobby.selfId = id;
  lobby.isHost = false;

  const conn = guest.connect(hostId, { reliable: true });
  attachLobbyDataConn(conn, hostId);

  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('Lobby nicht erreichbar. Seite neu laden und erneut versuchen.')),
      12000
    );
    conn.on('open', () => {
      clearTimeout(t);
      resolve();
    });
    conn.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function wirePeerEvents() {
  const peer = state.peer;
  peer.on('connection', (conn) => {
    attachDataConn(conn, conn.peer);
    conn.on('open', () => {
      // hello arrives via data; also seed peer stub
      if (!state.peers.has(conn.peer)) {
        state.peers.set(conn.peer, {
          id: conn.peer,
          name: 'Gast…',
          device: 'Browser',
          _remoteTalking: false,
        });
        renderPeers();
      }
    });
  });

  peer.on('call', (call) => {
    answerIncoming(call);
  });

  peer.on('disconnected', () => {
    setStatus('Reconnect…', true);
    try {
      peer.reconnect();
    } catch {
      /* ignore */
    }
  });

  peer.on('close', () => {
    if (!state.destroyed) setStatus('Verbindung beendet', true);
  });

  peer.on('error', (err) => {
    console.warn('peer error', err);
    if (err?.type === 'network') setStatus('Netzwerkfehler', true);
  });
}

function wireLobbyPeerEvents() {
  const peer = lobby.peer;
  peer.on('connection', (conn) => {
    attachLobbyDataConn(conn, conn.peer);
    conn.on('open', () => {
      if (!lobby.peers.has(conn.peer)) {
        lobby.peers.set(conn.peer, {
          id: conn.peer,
          name: 'Gast…',
          device: 'Browser',
          status: 'online',
          updatedAt: Date.now(),
        });
        renderLobbyPeers();
      }
    });
  });

  peer.on('disconnected', () => {
    setLobbyStatus('Getrennt — reconnect…', true);
    try {
      peer.reconnect();
    } catch {
      /* ignore */
    }
  });

  peer.on('close', () => {
    if (!lobby.destroyed) setLobbyStatus('Verbindung beendet', true);
  });

  peer.on('error', (err) => {
    console.warn('lobby peer error', err);
    if (err?.type === 'network') setLobbyStatus('Netzwerkfehler', true);
  });
}

function startLobbyHeartbeat() {
  stopLobbyHeartbeat();
  lobby.heartbeatTimer = setInterval(() => {
    if (!lobby.peer || lobby.destroyed) return;
    const payload = { type: 'lobby-ping', peer: lobbySelfMeta() };
    if (lobby.isHost) {
      lobbyBroadcast(payload);
      pushLobbyPeerList();
    } else {
      lobbySendTo(lobby.hostId, { type: 'lobby-relay', payload });
      lobbyBroadcast(payload);
    }
  }, LOBBY_HEARTBEAT_MS);
}

function stopLobbyHeartbeat() {
  if (lobby.heartbeatTimer) {
    clearInterval(lobby.heartbeatTimer);
    lobby.heartbeatTimer = null;
  }
}

function setLobbyBusy(busy) {
  lobby.status = busy ? 'busy' : 'online';
  if (!lobby.peer || !lobby.selfId) return;
  const payload = { type: 'lobby-ping', peer: lobbySelfMeta() };
  if (lobby.isHost) {
    lobbyBroadcast(payload);
    pushLobbyPeerList();
  } else {
    lobbySendTo(lobby.hostId, { type: 'lobby-relay', payload });
    lobbyBroadcast(payload);
  }
}

async function enterLobby() {
  if (!isSecureEnough()) {
    els.lobbyJoinHint.textContent =
      'Secure Context nötig (HTTPS oder localhost). Bitte die gehostete HTTPS-URL öffnen.';
    els.lobbyJoinHint.classList.add('warn');
    return;
  }

  const name = els.nameInput.value.trim() || `Gast-${Math.floor(Math.random() * 90 + 10)}`;
  lobby.displayName = name;
  state.displayName = name;
  saveName(name);

  els.enterLobbyBtn.disabled = true;
  els.enterLobbyBtn.textContent = 'Verbinde…';
  els.lobbyJoinHint.classList.remove('warn');
  els.lobbyJoinHint.textContent = 'Lobby über PeerJS…';

  try {
    await createLobbyHostOrGuest();
    wireLobbyPeerEvents();
    startLobbyHeartbeat();

    els.lobbyYouName.textContent = name;
    setLobbyStatus(lobby.isHost ? 'Online · Lobby-Host' : 'Online');

    els.lobbyJoinPanel.classList.add('hidden');
    els.lobbyPanel.classList.remove('hidden');
    renderLobbyPeers();
  } catch (err) {
    console.error(err);
    cleanupLobby();
    els.enterLobbyBtn.disabled = false;
    els.enterLobbyBtn.textContent = 'Lobby betreten';
    els.lobbyJoinHint.textContent = `Lobby fehlgeschlagen: ${err.message || err}`;
    els.lobbyJoinHint.classList.add('warn');
  }
}

async function join() {
  if (!isSecureEnough()) {
    els.joinHint.textContent = 'Mikrofon braucht HTTPS (oder localhost).';
    els.joinHint.classList.add('warn');
    return;
  }

  const roomCode = normalizeRoom(els.roomInput.value);
  if (roomCode.length < 4) {
    els.joinHint.textContent = 'Raumcode: mind. 4 Zeichen.';
    els.joinHint.classList.add('warn');
    if (els.roomJoinDetails) els.roomJoinDetails.open = true;
    return;
  }

  const expiresAt = state.roomExpiresAt || loadRoomExpiry(roomCode);
  if (expiresAt && Date.now() > expiresAt) {
    els.joinHint.textContent =
      'Dieser gepaarte Raumcode ist abgelaufen (ca. 10 Min.). Bitte neu anfragen oder „Neu“ tippen.';
    els.joinHint.classList.add('warn');
    clearRoomExpiry();
    if (els.roomJoinDetails) els.roomJoinDetails.open = true;
    return;
  }

  const name =
    (els.nameInput.value.trim() || state.displayName || lobby.displayName) ||
    `Gast-${Math.floor(Math.random() * 90 + 10)}`;
  state.displayName = name;
  state.mode = selectedMode();
  state.roomCode = roomCode;
  state.roomExpiresAt = expiresAt || null;
  saveName(name);
  saveRoom(roomCode);
  if (expiresAt) saveRoomExpiry(roomCode, expiresAt);
  else saveRoomExpiry(roomCode, null);

  els.joinBtn.disabled = true;
  els.joinBtn.textContent = 'Verbinde…';
  els.joinHint.classList.remove('warn');
  els.joinHint.textContent = '';

  try {
    await ensureMic();
    await createAsHostOrGuest(roomCode);
    wirePeerEvents();

    els.youName.textContent = name;
    els.roomLabel.textContent = roomCode;
    els.modeChip.textContent = state.mode === 'group' ? 'Gruppe' : '1:1';
    els.sessionGuide.textContent =
      state.mode === 'group'
        ? 'Taste halten zum Speeken — alle im Raum hören mit.'
        : 'Partner antippen, dann Taste halten zum Speeken.';
    setStatus(state.isHost ? 'Host' : 'Online');

    els.lobbyJoinPanel.classList.add('hidden');
    els.lobbyPanel.classList.add('hidden');
    els.sessionPanel.classList.remove('hidden');

    if (state.mode === 'group') {
      els.talkDock.classList.remove('hidden');
      els.leaveTalkBtn.classList.add('hidden');
      els.talkTarget.textContent = 'Gruppe';
    }

    setLobbyBusy(true);
    renderPeers();
  } catch (err) {
    console.error(err);
    cleanupSession();
    els.joinBtn.disabled = false;
    els.joinBtn.textContent = 'Beitreten';
    els.joinHint.textContent = `Fehler: ${err.message || err}`;
    els.joinHint.classList.add('warn');
    if (els.roomJoinDetails) els.roomJoinDetails.open = true;
  }
}

function cleanupSession() {
  state.destroyed = true;
  setPtt(false);
  for (const id of [...state.mediaCalls.keys()]) teardownMedia(id);
  for (const [, conn] of state.dataCons) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
  }
  state.dataCons.clear();
  state.peers.clear();
  if (state.peer) {
    try {
      state.peer.destroy();
    } catch {
      /* ignore */
    }
  }
  state.peer = null;
  state.selfId = null;
  state.isHost = false;
  state.activePeerId = null;
  state.destroyed = false;

  if (state.localStream) {
    for (const t of state.localStream.getTracks()) t.stop();
    state.localStream = null;
    state.localTrack = null;
  }

  setLobbyBusy(false);
}

function cleanupLobby() {
  lobby.destroyed = true;
  stopLobbyHeartbeat();
  for (const [, conn] of lobby.dataCons) {
    try {
      conn.close();
    } catch {
      /* ignore */
    }
  }
  lobby.dataCons.clear();
  lobby.peers.clear();
  if (lobby.peer) {
    try {
      lobby.peer.destroy();
    } catch {
      /* ignore */
    }
  }
  lobby.peer = null;
  lobby.selfId = null;
  lobby.isHost = false;
  lobby.hostId = '';
  lobby.status = 'online';
  lobby.destroyed = false;
  renderLobbyPeers();
}

function leaveRoom() {
  cleanupSession();
  clearRoomExpiry();
  els.sessionPanel.classList.add('hidden');
  els.talkDock.classList.add('hidden');
  els.joinBtn.disabled = false;
  els.joinBtn.textContent = 'Beitreten';
  els.joinHint.textContent = '';
  els.joinHint.classList.remove('warn');
  renderPeers();

  if (lobby.selfId && lobby.peer) {
    els.lobbyPanel.classList.remove('hidden');
    setLobbyStatus(lobby.isHost ? 'Online · Lobby-Host' : 'Online');
  } else {
    els.lobbyJoinPanel.classList.remove('hidden');
  }
}

/** Auto-join after pair-approve (always 1:1, short-lived code). Keeps lobby session (busy). */
async function joinWithPairedCode({ roomCode, expiresAt, peerName }) {
  const code = normalizeRoom(roomCode);
  els.roomInput.value = code;
  state.roomExpiresAt = expiresAt || Date.now() + PAIR_TTL_MS;
  saveRoomExpiry(code, state.roomExpiresAt);
  const one = document.querySelector('input[name="mode"][value="one"]');
  if (one) one.checked = true;
  els.joinHint.classList.remove('warn');
  els.joinHint.textContent = peerName
    ? `Gepaart mit ${peerName} — trete dem 1:1-Raum bei…`
    : 'Gepaarter Code — trete dem 1:1-Raum bei…';
  if (els.roomJoinDetails) els.roomJoinDetails.open = true;
  await join();
}

function initPairing() {
  pairing = createPairingController({
    getSelfMeta: () => (lobby.selfId ? lobbySelfMeta() : null),
    connectPeer: connectLobbyPeer,
    onApprovedJoin: (info) => joinWithPairedCode(info),
    els,
  });
  pairing.bindUi();
  // Wire any lobby connections that already exist.
  for (const conn of lobby.dataCons.values()) {
    if (conn.open) pairing.wireConn(conn);
  }
}

function leaveLobby() {
  if (state.peer) cleanupSession();
  cleanupLobby();
  els.lobbyPanel.classList.add('hidden');
  els.sessionPanel.classList.add('hidden');
  els.lobbyJoinPanel.classList.remove('hidden');
  els.enterLobbyBtn.disabled = false;
  els.enterLobbyBtn.textContent = 'Lobby betreten';
  els.lobbyJoinHint.textContent =
    'Name → Online-Liste → „Code anfragen“ oder Raumcode zum Speeken.';
  els.lobbyJoinHint.classList.remove('warn');
}

function showRoomJoinFromLobby() {
  // Keep lobby PeerJS session; only switch UI to room-code form.
  els.lobbyPanel.classList.add('hidden');
  els.lobbyJoinPanel.classList.remove('hidden');
  if (els.roomJoinDetails) els.roomJoinDetails.open = true;
  if (lobby.selfId) {
    els.enterLobbyBtn.textContent = 'Zurück zur Lobby';
    els.lobbyJoinHint.textContent =
      'Du bleibst online in der Lobby. Raumcode eingeben zum Speeken — oder zurück zur Online-Liste.';
    els.lobbyJoinHint.classList.remove('warn');
  }
  els.roomInput.focus();
}

function returnToLobbyUi() {
  if (!lobby.selfId || !lobby.peer) {
    enterLobby();
    return;
  }
  els.lobbyJoinPanel.classList.add('hidden');
  els.lobbyPanel.classList.remove('hidden');
  els.enterLobbyBtn.textContent = 'Lobby betreten';
  setLobbyStatus(lobby.isHost ? 'Online · Lobby-Host' : 'Online');
  renderLobbyPeers();
}

function boot() {
  if (typeof Peer === 'undefined') {
    els.lobbyJoinHint.textContent = 'PeerJS fehlt.';
    els.lobbyJoinHint.classList.add('warn');
    els.enterLobbyBtn.disabled = true;
    els.joinBtn.disabled = true;
    return;
  }

  els.nameInput.value = savedName();
  const room = normalizeRoom(savedRoom()) || generateRoomCode();
  els.roomInput.value = room;

  if (!isSecureEnough()) {
    els.lobbyJoinHint.textContent = 'Kein Secure Context — HTTPS nutzen.';
    els.lobbyJoinHint.classList.add('warn');
  }

  bindPtt();
  initPairing();
  // Neu always draws a fresh CSPRNG code (shared helper — pairing can call the same).
  els.genRoomBtn.addEventListener('click', () => {
    els.roomInput.value = generateRoomCode();
    clearRoomExpiry();
  });
  els.enterLobbyBtn.addEventListener('click', () => {
    if (lobby.selfId && lobby.peer) {
      returnToLobbyUi();
      return;
    }
    enterLobby();
  });
  els.joinBtn.addEventListener('click', join);
  els.roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  els.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (lobby.selfId && lobby.peer) returnToLobbyUi();
      else enterLobby();
    }
  });
  els.leaveTalkBtn.addEventListener('click', leaveTalk);
  els.leaveRoomBtn.addEventListener('click', leaveRoom);
  els.leaveLobbyBtn.addEventListener('click', leaveLobby);
  els.openRoomFromLobbyBtn.addEventListener('click', showRoomJoinFromLobby);

  // Expose for automated tests + pairing
  const lobbyApi = {
    getPeers: () =>
      [...lobby.peers.values()].map(({ id, name, device, status }) => ({
        id,
        name,
        device,
        status: status || 'online',
      })),
    getSelf: () => (lobby.selfId ? lobbySelfMeta() : null),
    getSpaceId: () => lobby.spaceId || null,
    getLobbyId: () => SHARED_LOBBY_ID,
    isConnected: () => !!(lobby.peer && lobby.selfId),
    connectPeer: connectLobbyPeer,
    lobbyPeerId,
    sharedLobbyId: SHARED_LOBBY_ID,
    on: onLobbyEvent,
    off: (eventName, handler) => lobbyListeners.get(eventName)?.delete(handler),
  };

  // Expose for automated tests + pairing agents (import ./room-code.js or use this).
  const testApi = {
    getState: () => ({
      selfId: state.selfId,
      isHost: state.isHost,
      roomCode: state.roomCode,
      roomExpiresAt: state.roomExpiresAt,
      mode: state.mode,
      peerCount: state.peers.size,
      peers: [...state.peers.values()].map((p) => ({ id: p.id, name: p.name })),
      connected: !!(state.peer && state.selfId),
      lobbyConnected: !!(lobby.peer && lobby.selfId),
      spaceId: lobby.spaceId || null,
      lobbyId: SHARED_LOBBY_ID,
      lobbyPeers: lobbyApi.getPeers(),
    }),
    normalizeRoom,
    hostPeerId,
    lobbyPeerId,
    sharedLobbyId: SHARED_LOBBY_ID,
    joinWithPairedCode,
    requestPair: (peerId, name) => pairing?.requestCode(peerId, name),
    approvePair: () => pairing?.approveIncoming(),
    generateRoomCode,
    lobby: lobbyApi,
  };
  window.__speek = testApi;
  window.__speedchat = testApi; // legacy alias
}

boot();
