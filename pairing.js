/**
 * Safe-code pairing over PeerJS DataConnections.
 *
 * Flow: A → pair-request → B approve/deny → pair-approve { roomCode, expiresAt }
 * → both join 1:1 Speek room. Codes are 6 chars, TTL ~10 minutes.
 *
 * Integrates with lobby via `speek:lobby-peer-actions` / connectPeer(peerId).
 */

export const PAIR_TTL_MS = 10 * 60 * 1000;
export const PAIR_CODE_LEN = 6;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSafeRoomCode() {
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(PAIR_CODE_LEN));
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseMsg(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === 'object' ? data : null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatExpiry(expiresAt) {
  try {
    return new Date(expiresAt).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/**
 * @param {object} opts
 * @param {() => {id:string,name:string,device?:string}|null} opts.getSelfMeta
 * @param {(peerId: string) => Promise<import('peerjs').DataConnection>} opts.connectPeer
 * @param {(info: {roomCode:string, expiresAt:number, peerName:string, role:'requester'|'approver'}) => void|Promise<void>} opts.onApprovedJoin
 * @param {object} opts.els — DOM refs for modal / toast
 */
export function createPairingController(opts) {
  const { getSelfMeta, connectPeer, onApprovedJoin, els } = opts;

  /** @type {Map<string, {peerId:string, name:string, role:'out'|'in', conn?: import('peerjs').DataConnection}>} */
  const pending = new Map();
  /** @type {WeakMap<object, true>} */
  const wired = new WeakMap();
  let busy = false;

  function setPairHint(text, warn = false) {
    if (!els.pairHint) return;
    els.pairHint.textContent = text || '';
    els.pairHint.classList.toggle('warn', !!warn);
  }

  function hideIncoming() {
    els.pairModal?.classList.add('hidden');
    els.pairModalBackdrop?.classList.add('hidden');
  }

  function showIncoming({ name, requestId: rid }) {
    if (!els.pairModal) return;
    if (els.pairModalTitle) els.pairModalTitle.textContent = 'Code-Anfrage';
    if (els.pairModalBody) {
      els.pairModalBody.innerHTML = `<strong>${escapeHtml(name)}</strong> möchte einen sicheren 1:1-Raumcode mit dir teilen.`;
    }
    els.pairModal.dataset.requestId = rid;
    els.pairModal.classList.remove('hidden');
    els.pairModalBackdrop?.classList.remove('hidden');
  }

  function wireConn(conn) {
    if (!conn || wired.has(conn)) return;
    wired.set(conn, true);

    conn.on('data', (data) => {
      const msg = parseMsg(data);
      if (!msg || !msg.type) return;
      if (msg.type === 'pair-request') handleIncomingRequest(conn, msg);
      else if (msg.type === 'pair-approve') handleApprove(msg);
      else if (msg.type === 'pair-deny') handleDeny(msg);
    });
  }

  function handleIncomingRequest(conn, msg) {
    if (!msg.requestId || !msg.from?.id) return;
    const fromName = msg.from.name || 'Jemand';
    pending.set(msg.requestId, {
      peerId: msg.from.id,
      name: fromName,
      role: 'in',
      conn,
    });
    showIncoming({ name: fromName, requestId: msg.requestId });
  }

  async function handleApprove(msg) {
    if (!msg.requestId || !msg.roomCode) return;
    const entry = pending.get(msg.requestId);
    pending.delete(msg.requestId);
    if (!entry || entry.role !== 'out') return;
    setPairHint(`Code erhalten: ${msg.roomCode} — trete bei…`);
    busy = false;
    hideIncoming();
    await onApprovedJoin({
      roomCode: String(msg.roomCode).toUpperCase(),
      expiresAt: msg.expiresAt || Date.now() + PAIR_TTL_MS,
      peerName: msg.from?.name || entry.name || 'Partner',
      role: 'requester',
    });
  }

  function handleDeny(msg) {
    if (!msg.requestId) return;
    const entry = pending.get(msg.requestId);
    pending.delete(msg.requestId);
    busy = false;
    setPairHint(
      entry ? `${entry.name} hat die Anfrage abgelehnt.` : 'Anfrage abgelehnt.',
      true
    );
  }

  async function requestCode(peerId, peerName) {
    if (busy) {
      setPairHint('Bitte warte auf die laufende Anfrage.', true);
      return;
    }
    const self = getSelfMeta();
    if (!self?.id) {
      setPairHint('Zuerst die Lobby betreten.', true);
      return;
    }
    if (peerId === self.id) return;

    busy = true;
    setPairHint(`Anfrage an ${peerName || 'Peer'}…`);
    try {
      const conn = await connectPeer(peerId);
      wireConn(conn);
      const rid = requestId();
      pending.set(rid, { peerId, name: peerName || 'Peer', role: 'out', conn });
      conn.send(
        JSON.stringify({
          type: 'pair-request',
          requestId: rid,
          from: self,
          ts: Date.now(),
        })
      );
      setPairHint(`Warte auf Freigabe von ${peerName || 'Peer'}…`);
    } catch (err) {
      busy = false;
      setPairHint(`Anfrage fehlgeschlagen: ${err.message || err}`, true);
    }
  }

  async function approveIncoming() {
    const rid = els.pairModal?.dataset.requestId;
    if (!rid) return;
    const entry = pending.get(rid);
    if (!entry || entry.role !== 'in') {
      hideIncoming();
      return;
    }
    const self = getSelfMeta();
    const roomCode = generateSafeRoomCode();
    const expiresAt = Date.now() + PAIR_TTL_MS;
    const payload = {
      type: 'pair-approve',
      requestId: rid,
      roomCode,
      expiresAt,
      from: self,
    };
    try {
      let conn = entry.conn;
      if (!conn?.open) conn = await connectPeer(entry.peerId);
      wireConn(conn);
      conn.send(JSON.stringify(payload));
    } catch (err) {
      setPairHint(`Freigabe senden fehlgeschlagen: ${err.message || err}`, true);
      return;
    }
    pending.delete(rid);
    hideIncoming();
    setPairHint(`Raumcode ${roomCode} · gültig bis ${formatExpiry(expiresAt)}`);
    busy = false;
    await onApprovedJoin({
      roomCode,
      expiresAt,
      peerName: entry.name,
      role: 'approver',
    });
  }

  function denyIncoming() {
    const rid = els.pairModal?.dataset.requestId;
    if (!rid) {
      hideIncoming();
      return;
    }
    const entry = pending.get(rid);
    if (entry?.conn?.open) {
      try {
        entry.conn.send(
          JSON.stringify({
            type: 'pair-deny',
            requestId: rid,
            from: getSelfMeta(),
          })
        );
      } catch {
        /* ignore */
      }
    }
    pending.delete(rid);
    hideIncoming();
    setPairHint('Anfrage abgelehnt.');
    busy = false;
  }

  function injectAskButton({ peer, actionsEl }) {
    if (!actionsEl || actionsEl.querySelector('[data-speek-ask-code]')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn secondary tiny';
    btn.dataset.speekAskCode = '1';
    btn.textContent = 'Code anfragen';
    if (peer.status === 'busy') {
      btn.title = 'Person ist im Gespräch — Anfrage trotzdem möglich';
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      void requestCode(peer.id, peer.name);
    });
    actionsEl.append(btn);
  }

  function bindUi() {
    els.pairApproveBtn?.addEventListener('click', () => {
      void approveIncoming();
    });
    els.pairDenyBtn?.addEventListener('click', denyIncoming);
    els.pairModalBackdrop?.addEventListener('click', denyIncoming);

    document.addEventListener('speek:lobby-peer-actions', (ev) => {
      injectAskButton(ev.detail || {});
    });
  }

  return {
    requestCode,
    approveIncoming,
    denyIncoming,
    wireConn,
    injectAskButton,
    bindUi,
    setPairHint,
    PAIR_TTL_MS,
  };
}
