# HistFzf Privacy Policy

Last updated: 2026-09-12

HistFzf is a browser extension that gives you fast, local, keyboard-first search over
your own browsing history. It is designed so that **all data stays on your machine**.

## What data is accessed and why

| Data | Where it lives | Why it is needed |
|---|---|---|
| Browsing history (URLs, page titles, visit counts) | The extension's own local database (IndexedDB and `chrome.storage.local` in your browser profile) | History is the data you explicitly want to search — the extension copies it on first install and records every new visit so it can surface pages beyond Chrome's ~90-day retention. |
| Site favicons | Served by Chrome from its own local cache via the `_favicon` endpoint | Displayed next to search results. |
| Your ranking preferences | `chrome.storage.local` | Persist the options you set (ranking weights, recency horizon). |

## What we do NOT do

- We do **not** transmit, upload, sell, share, or use your data for any purpose other
  than providing history search to you, the user, on your device.
- We do **not** collect analytics, crash reports, or telemetry.
- We do **not** make network requests of any kind.
- We do **not** load or execute remote code. Every script, style, and asset is bundled
  inside the extension package (Manifest V3).
- We do **not** read page content, cookies, credentials, or anything beyond what
  Chrome itself already shows in your local history.

## Data retention and deletion

- History data persists locally in your browser profile so the index keeps working
  across restarts.
- Extended history retention is a deliberate feature: deleting your Chrome browsing
  history does **not** delete HistFzf's local copy.
- To delete everything: remove the HistFzf extension (Chrome deletes all local
  extension data), or clear the extension's storage from the extension's details page.

## Contact

Abhishek Kedia — iamabhikedia74@gmail.com
