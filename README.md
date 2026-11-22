# Speek (hosted)

Browser-only Push-to-Talk: **gleichen Link** auf PC und Handy öffnen, **Raumcode** eingeben, speeken.

Kein Node auf dem Gerät · kein lokales WLAN nötig · keine Firewall-Freigabe.

---

## START (30 Sekunden)

1. Gehostete HTTPS-URL öffnen (Cursor Publish oder lokaler Testserver).
2. Namen tippen.
3. **Raumcode** eingeben oder **Neu** erzeugen — denselben Code an die anderen geben.
4. Modus wählen:
   - **1:1** — Partner in der Liste antippen, dann Taste halten
   - **Gruppe** — Taste halten → alle im Raum hören
5. Mikrofon erlauben → **Halten & speeken** (oder **Leertaste**).

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
- **Signaling / Presence:** PeerJS Cloud (`0.peerjs.com`) — Raum-Host-Peer-ID aus dem Raumcode
- **Medien:** WebRTC `MediaConnection` (Audio-Tracks), PTT via `MediaStreamTrack.enabled`
- **1:1:** eine Medienverbindung zum gewählten Peer
- **Gruppe:** Mesh zwischen Teilnehmern im Raum (kleine Gruppen)

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

Automatischer Signaling-Test (Playwright):

```bash
npm install
npm run test:join
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
