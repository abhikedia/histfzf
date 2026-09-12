import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'histfzf',
  // ≤132 chars — browsers and the store surface this line.
  description: 'fzf for your Chrome history — a keyboard-first command palette that keeps your history forever.',
  version: pkg.version,
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  permissions: [
    'history',
    'tabs',
    'storage',
    'activeTab',
    'scripting',
    'favicon',
  ],
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  commands: {
    'toggle-palette': {
      // Mac: literal Ctrl+R (macOS reloads with Cmd+R, so physical
      // Ctrl+R is free there — user preference). Windows/Linux:
      // Ctrl+Shift+Space; plain Ctrl+R is the reload binding there,
      // and Ctrl+Alt combos are ILLEGAL in chrome.commands (AltGr
      // clash), so this is the conflict-free equivalent.
      suggested_key: {
        default: 'Ctrl+Shift+Space',
        mac: 'MacCtrl+R',
      },
      description: 'Toggle the HistFzf palette',
    },
  },
  // Omnibox keyword: typing `h` + Space in the address bar routes the
  // rest of the query to the extension — the one entry point that works
  // everywhere, including Chrome's own privileged pages.
  omnibox: {
    keyword: 'h',
  },
  // Options page: ranking-weight tuners. Embedded (not open-in-tab) —
  // opened from chrome://extensions → Details → Extension options.
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: false,
  },
  web_accessible_resources: [
    {
      resources: ['src/overlay/index.html'],
      matches: ['<all_urls>'],
    },
  ],
})
