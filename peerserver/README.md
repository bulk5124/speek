# Speek PeerServer (LAN / WLAN only)

Eigenes **PeerJS-Signaling** im Büro-WLAN. Geräte **außerhalb** des Netzes erreichen den Server nicht → Speek funktioniert nur **im gleichen LAN**.

Kein öffentliches PeerJS-Cloud nötig für den Firmenpfad. Die **öffentliche** GitHub-Pages-Demo bleibt unverändert (Cloud-Default).

---

## Schnellstart (Anfänger, ein Windows/Mac-PC)

### 1. Node.js installieren

Node **≥ 18** von [nodejs.org](https://nodejs.org) (LTS).

### 2. PeerServer + Speek auf einem PC

Im Ordner `peerserver`:

```bash
npm install
npm run certs
npm run start:lan
```

Die Konsole zeigt eine URL wie:

`https://192.168.1.20:8443/?peerHost=192.168.1.20&peerPort=8443&peerPath=/peerjs&peerSecure=1`

### 3. Firewall

Port **8443/TCP** im privaten Netzwerk erlauben (Windows: Firewall-Hinweis bestätigen).

### 4. Handys / andere PCs (gleiches WLAN)

1. Dieselbe URL öffnen (Chrome / Edge / Safari).
2. **Zertifikatswarnung** einmal akzeptieren (self-signed).
3. Namen eingeben → Lobby → speeken.

**Wichtig:** Gast-WLAN mit Client-Isolation blockiert oft Gerät-zu-Gerät. Firmen-/Privat-WLAN nutzen.

---

## Nur PeerServer (Static separat)

Wenn Speek-Dateien schon per HTTPS laufen (IIS, nginx, Caddy):

```bash
cd peerserver
npm install
npm start
# → http://0.0.0.0:9000/peerjs
```

Client-URL (Beispiel):

```
https://speek.firma.intern/?peerHost=192.168.1.20&peerPort=9000&peerPath=/peerjs&peerSecure=0
```

> Von einer **HTTPS**-Seite zu **HTTP**-PeerServer kann der Browser Mixed Content blockieren. Dann TLS auf dem PeerServer (`SSL_KEY` / `SSL_CERT`) oder Reverse-Proxy unter demselben Host — oder `npm run start:lan` (ein Port, ein Zertifikat).

### Docker

```bash
cd peerserver
docker compose up -d
# Port 9000 — nur im LAN binden / nicht ins Internet freigeben
```

Oder Image: `peerjs/peerjs-server` mit `--path /peerjs`.

---

## Client-Konfiguration

| Quelle | Beispiel |
|--------|----------|
| **Query** | `?peerHost=192.168.1.20&peerPort=8443&peerPath=/peerjs&peerSecure=1` |
| **Same-origin** | `?peerSameOrigin=1` (wenn `serve-lan` App + Peer auf einem Origin hostet) |
| **localStorage** | Query wird unter `speek.peerConfig` gespeichert — nächster Besuch ohne Params |
| **Reset** | `?peerReset=1` → zurück zum Cloud-Default |
| **Inline** | `window.SPEEK_PEER_CONFIG = { host, port, path, secure }` vor `app.js` |

Ohne Parameter: **PeerJS Cloud** (`0.peerjs.com`) — Demo / GitHub Pages.

---

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|----------|---------|-----------|
| `HOST` | `0.0.0.0` | Bind-Adresse (LAN) |
| `PORT` | `9000` / `8443` (lan) | Port |
| `PEER_PATH` | `/peerjs` | PeerJS path |
| `PEER_KEY` | `peerjs` | PeerJS key |
| `SSL_KEY` / `SSL_CERT` | `certs/*` (lan) | TLS |
| `HTTP=1` | — | Nur HTTP (Mic auf echten Geräten oft blockiert) |

---

## Sicherheit (kurz)

- Signaling sieht Metadaten (SDP/ICE), **nicht** die Sprache (WebRTC DTLS-SRTP).
- Port **nicht** per Port-Forwarding / Cloud-Tunnel öffentlich machen.
- Raumcodes weiterhin geheim halten.
- Self-signed nur für LAN-Pilot; Produktiv: Firmen-CA oder interner Proxy.

Ausführlich: [`../docs/speek-private-firm-hosting.md`](../docs/speek-private-firm-hosting.md)
