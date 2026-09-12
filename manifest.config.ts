import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'histfzf',
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
  web_accessible_resources: [
    {
      resources: ['src/overlay/index.html'],
      matches: ['<all_urls>'],
    },
  ],
})
