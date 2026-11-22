# Speek (hosted)

Browser-only Push-to-Talk: **gleichen Link** öffnen, optional **Firmen-Space** betreten (Online-Liste), dann **Raumcode** zum Speeken.

Kein Node auf dem Gerät · kein lokales WLAN nötig · keine Firewall-Freigabe.

---

## START (30 Sekunden)

1. Gehostete HTTPS-URL öffnen (Cursor Publish oder lokaler Testserver).
2. Namen tippen, optional **Firma / Space** (Standard `firm`) → **Lobby betreten**.
3. Unter **Online** siehst du andere im Space — **ohne Raumcode**.
4. Zum Speeken: **Mit Raumcode speeken** / **Raumcode eingeben**, Code teilen oder erzeugen.
5. Modus **1:1** oder **Gruppe** → Mikrofon → **Halten & speeken** (oder **Leertaste**).

Ausführlich: [`START.md`](./START.md)

---

## Sicherheit

| Thema | Bedeutung |
|--------|-----------|
| **Raumcode = Zugang** | Wer den Code kennt, kann dem Raum beitreten. |
| **Geheim halten** | Nicht öffentlich posten (Chat-Kanäle, Social Media). |
| **Nach der Session** | Neuen Code erzeugen (**Neu**). |
| **Verschlüsselung** | Sprache läuft **Ende-zu-Ende** über WebRTC **DTLS-SRTP** (Peer-to-Peer). Signaling (PeerJS) sieht nur SDP/ICE und Anwesenheit — keinen Sprachinhalt. |
| **Keine Secrets im Client** | Keine API-Keys; öffentliche STUN + PeerJS-Cloud. |

---

## Technik

- **Frontend:** statisches HTML/CSS/JS
- **Firm-Lobby:** PeerJS-Hub-ID `speeklobby{space}` (Space normalisiert, Default `firm`) — Online-Liste + Status
- **Signaling / Room presence:** PeerJS Cloud (`0.peerjs.com`) — Raum-Host-Peer-ID `scv1{code}`
- **Medien:** WebRTC `MediaConnection` (Audio-Tracks), PTT via `MediaStreamTrack.enabled` (unverändert)
- **1:1:** eine Medienverbindung zum gewählten Peer
- **Gruppe:** Mesh zwischen Teilnehmern im Raum (kleine Gruppen)
- **Pairing-Hooks:** `window.__speek.lobby` + Events `speek:lobby-peer-actions` / `speek:lobby-peers-changed` (Slot `.peer-actions` für „Code anfragen“)

Optionaler **lokaler** LAN-Pfad bleibt unter `apps/lan-ptt/` (eigener Node-Server) — nicht Teil dieses Hosted-Flows.

---

## Lokal testen

```bash
# Repo-Root (statische Site)
python3 -m http.server 8765 --bind 127.0.0.1
# → http://127.0.0.1:8765  (Mikrofon ok auf localhost)
# oder: npm start
```

Zwei Browserfenster / ein Inkognito-Fenster: gleicher Raumcode → Peer-Liste prüfen.

Automatische Signaling-Tests (Playwright):

```bash
npm install
npm run test:join
npm run test:lobby
```

---

## Hosting / öffnen

| Weg | Hinweis |
|-----|---------|
| **GitHub Pages** | Branch `main`, Ordner `/` (Root) → `https://bulk5124.github.io/speek/` — bei **privatem** Free-Repo oft nicht verfügbar |
| **Cursor Publish** | Repo-Root publishen (Slug z. B. `speek`), Sichtbarkeit **public** für Handy ohne Login |
| Lokal | siehe oben |

Ausführlich starten: [`START.md`](./START.md)

---

## Veröffentlichen (Cursor)

1. Dieses Repo ist der Hosted-App-Root (`index.html` + Assets).
2. Agent **auf dem Repo** → `publish-app` für Repo-Root (Slug z. B. `speek`).
3. Sichtbarkeit **public**, wenn PC + Handy ohne Login denselben Link brauchen.
4. HTTPS-Link teilen.

Alternative: GitHub Pages / Cloudflare Pages / Netlify (static). Signaling bleibt PeerJS Cloud.

---

## Grenzen

- PeerJS-Cloud und öffentliche STUN sind **kostenlos**, aber Drittanbieter — bei Ausfall kurz warten oder Code neu versuchen.
- Harte NATs ohne TURN: Verbindung kann scheitern (selten zwischen Handy-LTE und Heimnetz).
- Mesh skaliert für kleine Gruppen (~2–6), nicht für große Konferenzen.
- Gast-WLAN mit Client-Isolation betrifft **nicht** diesen Hosted-Pfad (kein LAN nötig).

---

## License

MIT
