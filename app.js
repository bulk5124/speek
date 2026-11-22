/**
 * Speek hosted — room-code PTT over PeerJS cloud + WebRTC media (DTLS-SRTP).
 * Presence/signaling via PeerJS DataConnections; voice is peer-to-peer MediaConnections.
 * PeerJS host-ID prefix `scv1` is protocol-stable — keep for room compatibility.
 */

const $ = (id) => document.getElementById(id);

const els = {
  joinPanel: $('joinPanel'),
  sessionPanel: $('sessionPanel'),
  nameInput: $('nameInput'),
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

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AVATAR_COLORS = ['#0b6e6e', '#2a5f8f', '#8a4b2a', '#5a4a8f', '#2f6b6b', '#6b3a4a'];

const state = {
  mode: 'one', // 'one' | 'group'
  roomCode: '',
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

function normalizeRoom(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

function generateRoomCode() {
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

function hostPeerId(roomCode) {
  // PeerJS IDs: keep alphanumeric; prefix avoids collisions with other apps.
  return `scv1${roomCode.toLowerCase()}`;
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

function pushPeerList() {
  if (!state.isHost) return;
  const peers = [selfMeta(), ...state.peers.values()].map(({ id, name, device }) => ({
    id,
    name,
    device,
  }));
  broadcast({ type: 'peers', peers });
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
    return;
  }

  const name = els.nameInput.value.trim() || `Gast-${Math.floor(Math.random() * 90 + 10)}`;
  state.displayName = name;
  state.mode = selectedMode();
  state.roomCode = roomCode;
  saveName(name);
  saveRoom(roomCode);

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

    els.joinPanel.classList.add('hidden');
    els.sessionPanel.classList.remove('hidden');

    if (state.mode === 'group') {
      els.talkDock.classList.remove('hidden');
      els.leaveTalkBtn.classList.add('hidden');
      els.talkTarget.textContent = 'Gruppe';
    }

    renderPeers();
  } catch (err) {
    console.error(err);
    cleanupSession();
    els.joinBtn.disabled = false;
    els.joinBtn.textContent = 'Beitreten';
    els.joinHint.textContent = `Fehler: ${err.message || err}`;
    els.joinHint.classList.add('warn');
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
}

function leaveRoom() {
  cleanupSession();
  els.sessionPanel.classList.add('hidden');
  els.joinPanel.classList.remove('hidden');
  els.talkDock.classList.add('hidden');
  els.joinBtn.disabled = false;
  els.joinBtn.textContent = 'Beitreten';
  els.joinHint.textContent = '';
  els.joinHint.classList.remove('warn');
  renderPeers();
}

function boot() {
  if (typeof Peer === 'undefined') {
    els.joinHint.textContent = 'PeerJS fehlt.';
    els.joinHint.classList.add('warn');
    els.joinBtn.disabled = true;
    return;
  }

  els.nameInput.value = savedName();
  const room = normalizeRoom(savedRoom()) || generateRoomCode();
  els.roomInput.value = room;

  if (!isSecureEnough()) {
    els.joinHint.textContent = 'Kein Secure Context — HTTPS nutzen.';
    els.joinHint.classList.add('warn');
  }

  bindPtt();
  els.genRoomBtn.addEventListener('click', () => {
    els.roomInput.value = generateRoomCode();
  });
  els.joinBtn.addEventListener('click', join);
  els.roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  els.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  els.leaveTalkBtn.addEventListener('click', leaveTalk);
  els.leaveRoomBtn.addEventListener('click', leaveRoom);

  // Expose for automated tests
  const testApi = {
    getState: () => ({
      selfId: state.selfId,
      isHost: state.isHost,
      roomCode: state.roomCode,
      mode: state.mode,
      peerCount: state.peers.size,
      peers: [...state.peers.values()].map((p) => ({ id: p.id, name: p.name })),
      connected: !!(state.peer && state.selfId),
    }),
    normalizeRoom,
    hostPeerId,
  };
  window.__speek = testApi;
  window.__speedchat = testApi; // legacy alias
}

boot();
