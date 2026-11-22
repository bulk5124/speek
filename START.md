# Speek starten — ganz einfach

Du brauchst **kein** Node.js, **kein** WLAN-Setup und **keine** Firewall.

---

## 1. Link öffnen

Öffne die **HTTPS-Adresse** von Speek im Browser (Chrome, Edge, Safari, Firefox) — **am PC und am Handy dieselbe URL**.

### Woher kommt der Link?

| Hosting | URL |
|---------|-----|
| **GitHub Pages** (wenn aktiv) | `https://bulk5124.github.io/speek/` |
| **Cursor Publish** | Link aus dem Publish-Dialog / App-Pill (öffentlich wählen, wenn Handy ohne Cursor-Login mitmachen soll) |
| **Lokal (nur PC)** | `http://127.0.0.1:8765` — `npm start` oder `python3 -m http.server 8765 --bind 127.0.0.1` im Repo-Root |

Mikrofon braucht **https://** (oder localhost). Teile denselben Link + denselben Raumcode.

---

## 2. Namen & Raumcode

1. Tippe deinen **Namen**.
2. Gib einen **Raumcode** ein (mindestens 4 Zeichen) **oder** tippe **Neu**, um einen frischen Code zu erzeugen.
3. Sag den Code den anderen (per WhatsApp/SMS) — **nicht öffentlich posten**.

---

## 3. Modus wählen

| Modus | Wann |
|--------|------|
| **1:1** | Nur mit **einer** Person speeken. Nach dem Beitritt die Person in der Liste antippen. |
| **Gruppe** | Alle im Raum hören dich, wenn du die Taste hältst. |

---

## 4. Beitreten & speeken

1. **Mikrofon & Raum beitreten** tippen und Mikrofon erlauben.
2. Warten, bis der Status **Online** zeigt und andere erscheinen.
3. **Halten & speeken** gedrückt halten (Finger oder Maus) — oder am PC die **Leertaste** halten.
4. Loslassen = stumm.

---

## Sicherheit (kurz)

- **Raumcode geheim halten** — er ist der Zugangsschutz.
- Nach dem Gespräch **neuen Code** erzeugen.
- Die Stimme ist **Ende-zu-Ende verschlüsselt** (WebRTC). Der Server sieht nur die Verbindungsdaten, nicht was ihr sagt.

---

## Probleme?

| Problem | Tipp |
|---------|------|
| Kein Mikrofon | Seite muss **https://** sein (nicht http außer localhost). |
| Niemand sichtbar | Gleichen **Raumcode** prüfen; beide Seiten neu laden. |
| Kein Ton | Einmal auf die Sprechtaste tippen (Browser-Audio freigeben); Lautsprecher/Headset prüfen. |
| Echo | Kopfhörer nutzen, wenn zwei Geräte im selben Raum sind. |
