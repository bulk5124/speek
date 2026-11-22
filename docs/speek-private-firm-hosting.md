# Speek — Privates Firmen-Hosting (LAN PeerServer, ohne öffentliches GitHub)

**Brand:** Speek · Verb: *speeken*  
**Ziel:** Kanzlei-/Firmen-Geräte im **gleichen WLAN/LAN** treffen sich per Browser-PTT — **ohne** PeerJS-Cloud und **ohne** öffentliches GitHub zur Laufzeit.

**App (Static):** Repo-Root (`index.html`, `app.js`, …)  
**LAN PeerServer:** [`../peerserver/`](../peerserver/)  
**Öffentlicher Demo-Pfad:** GitHub Pages / Cursor Publish mit Cloud-Default (`0.peerjs.com`)

> **Option 2 (dieser Doc-Fokus):** Self-hosted PeerServer nur im LAN → Clients außerhalb des Netzes erreichen Signaling nicht → Speek nur im gleichen Netzwerk.

---

## Kurzvergleich

| Option | Signaling | Öffentliches GitHub? | Typischer Einsatz |
|--------|-----------|----------------------|-------------------|
| **Demo / Pages** | PeerJS Cloud | Optional (Pages) | Öffentliche Demo |
| **2 — LAN PeerServer** (empfohlen Firma/WLAN) | Eigener PeerServer im Büro-LAN | Nein zur Laufzeit | Gleiches WiFi, ein Host-PC |
| **Intern + Proxy** | PeerServer hinter Firmen-VPN/Proxy | Nein | IT mit Reverse-Proxy |
| **Cursor Private Publish** | oft noch Cloud | Nein zur Laufzeit | Wenige Nutzer mit Cursor-Login |

---

## Option 2 — LAN/WLAN-only (Anfänger-Schritte)

Ein PC im Büro startet Speek (HTTPS) **und** den PeerServer. Handys/PCs im **gleichen WLAN** öffnen die LAN-URL.

### Voraussetzungen

- Ein PC mit **Node.js ≥ 18** (oder Docker)
- Geräte im **gleichen** WLAN (kein Gastnetz mit Client-Isolation)
- Browser: Chrome, Edge, Safari, Firefox

### A) Ein-Klick-LAN (Static + PeerServer, empfohlen)

```bash
cd peerserver
npm install
npm run certs          # self-signed Zertifikat für HTTPS + Mikrofon
npm run start:lan      # https://0.0.0.0:8443 + /peerjs
```

Die Konsole druckt z. B.:

```text
https://192.168.1.20:8443/?peerHost=192.168.1.20&peerPort=8443&peerPath=/peerjs&peerSecure=1
```

1. **Firewall:** Port **8443/TCP** im privaten Netz erlauben.  
2. Am Host und am Handy **dieselbe URL** öffnen.  
3. Zertifikatswarnung **einmal** akzeptieren.  
4. Namen → Lobby → Code anfragen / Raumcode → speeken.

Kein öffentliches Repo nötig: Ordner per USB/Share kopieren reicht.

### B) Nur PeerServer (Static schon vorhanden)

```bash
cd peerserver
npm install
npm start              # http://0.0.0.0:9000/peerjs
```

Oder Docker:

```bash
cd peerserver
docker compose up -d
```

Client auf den LAN-Host zeigen (Query bleibt in `localStorage`):

```text
https://<euer-static-host>/?peerHost=192.168.1.20&peerPort=9000&peerPath=/peerjs&peerSecure=0
```

**Hinweis Mixed Content:** HTTPS-Seite + HTTP-PeerServer kann vom Browser blockiert werden. Dann TLS am PeerServer, Reverse-Proxy unter demselben Host, oder Variante **A**.

### C) Same-Origin-Kurzform

Wenn App und PeerServer auf **einem** Origin laufen (`start:lan`):

```text
https://192.168.1.20:8443/?peerSameOrigin=1
```

---

## Client: PeerJS-Host konfigurieren

| Quelle | Wirkung |
|--------|---------|
| Query `peerHost`, `peerPort`, `peerPath`, `peerSecure`, `peerKey` | Sofort + Speichern in `localStorage` (`speek.peerConfig`) |
| `peerSameOrigin=1` | Host/Port/Secure von der Seiten-URL, Path `/peerjs` |
| `peerReset=1` | Gespeicherte LAN-Config löschen → Cloud-Default |
| `window.SPEEK_PEER_CONFIG` | Inline vor `app.js` (Build/IT) |
| Ohne alles | **Cloud** `0.peerjs.com` — Demo / GitHub Pages |

Implementierung: [`../peer-config.js`](../peer-config.js). Details: [`../peerserver/README.md`](../peerserver/README.md).

---

## Warum nur gleiches Netz?

- PeerServer bindet typisch `0.0.0.0` **nur im LAN** (kein Port-Forwarding, kein Cloud-Tunnel).
- Geräte außerhalb erreichen Host:Port nicht → kein Signaling → kein Speek.
- Medien bleiben WebRTC P2P (DTLS-SRTP); der PeerServer vermittelt nur SDP/ICE.

---

## Sicherheit (Kanzlei)

| Maßnahme | Praxis |
|----------|--------|
| Kein Public Pages für Firmendaten | Static intern oder LAN-Host |
| PeerServer nicht ins Internet | Kein Router-Port-Forward für 9000/8443 |
| Raumcodes | Geheim; nach Session neu |
| Zertifikat | Self-signed nur Pilot; später Firmen-CA / Proxy |
| Discovery | `allow_discovery: false` (Default hier) |

---

## Abnahmetest (zwei Geräte, gleiches WLAN)

- [ ] Host: `npm run start:lan` läuft, Health/`/peerjs` erreichbar
- [ ] Beide öffnen die gedruckte `https://<LAN-IP>:8443/…`-URL (nicht github.io)
- [ ] Lobby zeigt beide Online
- [ ] 1:1 oder Gruppe: Audio hörbar, PTT stumm beim Loslassen
- [ ] Gerät im **anderen** Netz / LTE: PeerServer nicht erreichbar → kein Join (erwartetes LAN-only)

---

## Demo-Pfad (unverändert)

GitHub Pages / öffentliche URL **ohne** Query → PeerJS Cloud. Gut für Demos; nicht der Firmen-Standard.

---

## Verwandt

- [`../peerserver/README.md`](../peerserver/README.md) — Node/Docker Kommandos  
- [`../START.md`](../START.md) — Bedienung Speek  
- [`../README.md`](../README.md) — Techniküberblick  
