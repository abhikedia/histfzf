# HistFzf

**fzf-style fuzzy search over your Chrome history — a Raycast-style command palette that survives beyond Chrome's 90-day window.**

Press one shortcut, type a loose fragment of a page title or URL (`ghpr` → `github.com/…/pulls`), see ranked results with the matched characters highlighted, hit Enter to jump.

> **Status: pre-alpha, in active development.** The data layer (history indexing, URL canonicalization, storage) is complete and fully tested; the search UI and shortcut delivery are under construction. See [Status](#status) for what works today.

---

## Why

Chrome's address-bar history search is weak: prefix-biased matching, opaque ranking, and Chrome only retains **~90 days** of history. HistFzf is for people who live in the keyboard and love the `fzf` finder: an independent, permanent copy of your history that you can fuzzy-match against with the *real* fzf algorithm.

- **`ghpr`⏎** — fuzzy subsequence matching over **title + URL**, with per-character highlighting
- **Own index, kept forever** — seeded from your existing history on install, then captured live visit-by-visit. Older than 90 days? Still there.
- **Frecency-ranked like Raycast/Arc** — pages you visit often and recently float up, but a bounded multiplier means popularity can never swamp a better match
- **Keyboard-first** — arrows/`Ctrl-n`/`Ctrl-p` to move, `Enter` to open, `Shift+Enter` for a new tab, `Esc` to close
- **Private and minimal** — everything stays on your machine (see [Privacy & permissions](#privacy--permissions))

## How it works

```
┌─ Service worker ─────────────────────────┐
│ seeds from chrome.history on install     │
│ (resumable), captures every visit live,  │
│ owns all writes to IndexedDB             │
└──────────────┬───────────────────────────┘
               │ shortcut → inject content script
               ▼
┌─ Page tab ───────────────────────────────┐
│ content script mounts an extension-origin│
│ iframe (CSS/CSP-isolated from the site)  │
│   └─ React palette:                      │
│      loads whole index once per open,    │
│      then searches purely in RAM         │
│      (fzf + frecency, <50ms/keystroke)   │
└──────────────────────────────────────────┘
```

Design highlights:

- **Own index, not Chrome's** — an independent IndexedDB copy (`{url, title, counts…}`) we seed once and maintain live, so ranking is ours and history outlives the 90-day eviction.
- **Authentic fzf** — the real fzf subsequence algorithm (via `fzf-for-js`) scores `title + " " + url`; matched characters are highlighted using the exact byte positions.
- **Bounded frecency blend** — `score × (1 + min(frecency, 2))`: frequency (log-compressed, typed visits count double) and recency (14-day exponential decay) reorder matches without ever stealing the win from a clearly better one.
- **URL canonicalization** — `github.com/pulls`, `github.com/pulls/` and `...?utm_source=x` collapse into one record; originals kept for navigation.
- **On-demand injection** — no all-sites content script; `activeTab` + `scripting` inject the palette only when you press the shortcut.
- **Search lives in RAM** — the palette loads the index once per open, then never touches the database per keystroke.

## Omnibox optional entry (`h` + Space)

Type `h`, Space, then a fuzzy fragment — suggestions live right in the address bar, on **any** tab including `chrome://` pages (where the palette can't inject). Enter opens in the current tab; the new-tab dispositions open a tab. Up to 6 rows, same ranking as the palette.

Known Chrome limitation: row icons in the keyword dropdown render inconsistently (Chrome's renderer decides per state) — the palette is the icon-rich surface.

## Privacy & permissions

HistFzf is a local, single-user tool. **Nothing ever leaves your machine** — no accounts, no analytics, no network calls.

Requested permissions and why:

| Permission | Reason |
|---|---|
| `history` | Seed the index from your existing history; capture new visits |
| `tabs` | Capture page titles (arrives separately from visits), open new tabs |
| `storage` | Seed progress watermark |
| `activeTab` + `scripting` | Inject the palette into the current tab on shortcut press — **no "read and change all your data on all websites" prompt** |
| `favicon` | Display favicons |

No host permissions, no `unlimitedStorage`. Clearing your Chrome history does **not** clear HistFzf's copy — that's the point of owning the index. (Removing the extension deletes everything.)

## Development

```bash
npm install
npm run dev        # dev build with HMR → dist/
npm run build      # typecheck + production build
npm run test       # vitest (unit tests)
npm run typecheck  # tsc only
```

Load it: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.

Rebind the shortcut at `chrome://extensions/shortcuts` (default: `Ctrl+Shift+Space`, Mac `Command+Shift+Space`).

## Status

| Milestone | Scope | State |
|---|---|---|
| Foundations | types, constants, URL canonicalization, IndexedDB storage, frecency ranking | ✅ done, tested |
| Injection shell | shortcut → inject → overlay round-trip, restricted-page fallback | ✅ done |
| Indexing | resumable history seed + live capture of counts and titles | ✅ done |
| Search & UI | fzf search + frecency + Raycast-style palette | ✅ done |
| Polish | icons, motion, UX fidelity pass | ✅ done |

Deferred (tracked as future work): omnibox keyword entry point, restricted-page (`chrome://`) fallback, options page, index pruning cap, light mode.

## Tech

TypeScript · React 19 · Vite + CRXJS · [`fzf-for-js`](https://github.com/ajitid/fzf-for-js) (BSD-3) · [`idb`](https://github.com/jakearchibald/idb) · vitest. No remote code, no CDNs, no eval — everything is bundled (Manifest V3 requirement).

## License

[MIT](./LICENSE) © 2026 Abhishek Kedia — free to use, modify, and ship; attribution appreciated but not required beyond the notice.
