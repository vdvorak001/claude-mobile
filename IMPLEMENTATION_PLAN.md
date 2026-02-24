# Claude Mobile — Implementation Plan
> Tento dokument podléhá změnovému řízení. Změny pouze po schválení vlastníkem.
> Poslední aktualizace: 2026-02-24

---

## Fáze 1: PWA (Progressive Web App)

### DONE

- [x] **1.1 Projekt skeleton**
  - Adresářová struktura (`claude-mobile/`)
  - `manifest.json` — PWA metadata, theme #0a0a0f, standalone display
  - `sw.js` — Service worker, cache-first pro statiku, network-first pro ntfy.sh
  - `index.html` — SPA shell, 3 views (Dashboard / History / Settings)
  - PWA ikony 192x192 a 512x512 (neon "C" generované Pillow)

- [x] **1.2 Neon CSS theme systém**
  - CSS custom properties (7 neon barev, glow presets, glassmorphism)
  - Dark background (#0a0a0f), backdrop-filter blur, border glow efekty
  - 5 typů notification karet: done (zelená), decision (amber), approve (cyan), permission (cyan), choice (magenta)
  - Mobile-first layout, 48px touch targets, safe-area-inset
  - Animace: slide-in, pulse-glow, pulse-dot

- [x] **1.3 ntfy.js — WebSocket modul**
  - WebSocket připojení k `wss://ntfy.sh/TOPIC/ws`
  - Auto-reconnect s exponential backoff (1s → 30s max)
  - Detekce typu zprávy z ntfy.sh tags (lock, point_right, question, white_check_mark, warning)
  - Extrakce action buttons a REQ_ID z message payload
  - Fetch historie při připojení (posledních 10 min)
  - Response publishing: `fetch POST` na reply topic

- [x] **1.4 ui.js — Rendering engine**
  - Notification karty s header (typ + čas), title, body, action buttons
  - Markdown rendering (**bold**), newline handling
  - Approve/Permission: OK + Deny tlačítka
  - Choice: A/B/C option karty s popisem
  - Answered stav: muted glow + status badge (Approved/Denied)

- [x] **1.5 app.js — Orchestrátor**
  - SPA navigace (Dashboard / History / Settings) via bottom nav
  - Event delegation pro response tlačítka
  - Pending area (sticky) pro čekající approve/permission/choice
  - LocalStorage: notification historie (max 100), settings, seen IDs
  - Vibration API pro actionable notifikace
  - Audio beep (Web Audio API, 880Hz sine)
  - Service worker registrace

### IN PROGRESS

- [ ] **1.6 Identifikace chatu/projektu**
  - Přidat název projektu do notifikací (z `cwd` nebo `$CLAUDE_PROJECT_DIR`)
  - Upravit `notify-mobile.sh` — přidat project name do title/body
  - Upravit `permission-hook.sh` — extrahovat `cwd` ze stdin JSON
  - PWA: zobrazit project badge na kartě

- [ ] **1.7 Vylepšení permission notifikací**
  - Kategorie příkazu (git / python / soubory / síť / systém)
  - Úroveň rizika (nízká / střední / vysoká) s barevným indikátorem
  - Lidsky čitelný popis co příkaz dělá
  - PWA: rozšířená karta s kategorie badge a risk level

### TODO

- [ ] **1.8 Nasazení na GitHub Pages**
  - Inicializace git repozitáře pro `claude-mobile/`
  - Push na GitHub (veřejný nebo privátní repo)
  - Aktivace GitHub Pages (branch `main`, root `/`)
  - HTTPS URL pro přístup odkudkoli
  - Aktualizace `manifest.json` start_url

- [ ] **1.9 Web Push notifikace**
  - VAPID klíče (veřejný + privátní)
  - Push subscription v service worker
  - Malý push server (Cloudflare Worker nebo GitHub Actions)
  - Alternativa: integrace s ntfy.sh UnifiedPush
  - Notifikace i když je PWA zavřená

- [ ] **1.10 Testování a polish**
  - E2E test: done → decision → choice → approve → permission
  - Test auto-reconnect (výpadek WiFi)
  - Test offline shell (service worker cache)
  - Test "Přidat na plochu" (PWA install)
  - Cross-browser: Chrome, Firefox, Samsung Internet
  - Performance audit (Lighthouse)

---

## Fáze 2: Nativní mobilní aplikace

### TODO

- [ ] **2.1 Výběr tech stacku a setup**
  - React Native + Expo (doporučeno) vs Flutter vs Kotlin
  - Inicializace projektu (Expo CLI)
  - Neon theme system (React Native StyleSheet)
  - Navigace (React Navigation — tabs)

- [ ] **2.2 Core UI — neon design**
  - Dashboard screen (live feed)
  - Notification karty (přenesení PWA designu do React Native)
  - History screen
  - Settings screen
  - Animace (React Native Animated / Reanimated)

- [ ] **2.3 ntfy.sh integrace**
  - WebSocket klient pro real-time notifikace
  - REST klient pro response publishing
  - Auto-reconnect a error handling
  - Background WebSocket (foreground service na Androidu)

- [ ] **2.4 Push notifikace**
  - Expo Push Notification Service nebo Firebase Cloud Messaging
  - Notifikace při zavřené aplikaci
  - Rich notifications s action buttons přímo v notification shade
  - Custom notification channel (zvuk, vibrace, priorita)

- [ ] **2.5 Rozšířené funkce**
  - Identifikace chatu/projektu s filtrováním
  - Historie rozhodnutí s vyhledáváním
  - Statistiky (kolik schváleno/zamítnuto, response time)
  - Biometrické ověření pro citlivé operace (volitelné)
  - Tmavý/světlý režim (neon zůstává výchozí)

- [ ] **2.6 Distribuce**
  - Expo EAS Build (APK / AAB)
  - Interní distribuce přes QR kód (bez Play Store)
  - Volitelně: Google Play Store listing
  - Auto-update mechanismus

- [ ] **2.7 Backend bridge (volitelné)**
  - Cloudflare Worker jako proxy mezi Claude Code a push service
  - Webhook endpoint pro přímé volání z hook skriptů
  - Eliminace závislosti na ntfy.sh (volitelné)

---

## Soubory projektu

| Soubor | Stav | Popis |
|--------|------|-------|
| `index.html` | DONE | SPA shell, 3 views |
| `manifest.json` | DONE | PWA metadata |
| `sw.js` | DONE | Service worker |
| `css/style.css` | DONE | Neon theme (11 KB) |
| `js/ntfy.js` | DONE | WebSocket modul (5 KB) |
| `js/ui.js` | DONE | Rendering engine (5.7 KB) |
| `js/app.js` | DONE | Orchestrátor (8.2 KB) |
| `icons/icon-192.png` | DONE | PWA ikona |
| `icons/icon-512.png` | DONE | PWA ikona |

---

## Závislosti

**Fáze 1 (PWA):** Zero dependencies — vanilla HTML/CSS/JS
**Fáze 2 (Nativní):** Node.js, Expo CLI, React Native, React Navigation

## Externí služby

- **ntfy.sh** — push/subscribe messaging (obě fáze)
- **GitHub Pages** — hosting PWA (Fáze 1)
- **Expo EAS** — build a distribuce nativní app (Fáze 2)
