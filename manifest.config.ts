import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'histfzf',
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
})
