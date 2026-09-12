// @vitest-environment jsdom
import { test, expect, beforeAll, beforeEach } from 'vitest'
import { installChromeMock, type ChromeHarness } from './test-harness'

let harness: ChromeHarness
let onExecute: () => void

const ORIGIN = 'chrome-extension://test'
const OVERLAY_URL = 'chrome-extension://test/src/overlay/index.html'

beforeAll(async () => {
  harness = installChromeMock()
  const mod = await import('./content')
  onExecute = mod.onExecute
})

beforeEach(() => {
  // jsdom keeps one document per FILE: every test starts from the
  // pristine page — no leftover frame, no leftover flags; the relay is
  // rebound because its stored handler is cleared below.
  const extWindow = window as unknown as { __histFzfRelay?: (e: MessageEvent) => void }
  if (extWindow.__histFzfRelay) {
    window.removeEventListener('message', extWindow.__histFzfRelay as EventListener)
    delete extWindow.__histFzfRelay
  }
  document.getElementById('histfzf-overlay-frame')?.remove()
  delete (window as unknown as { __histFzfOpen?: boolean }).__histFzfOpen
  harness.reset()
})

function getOverlayFrame(): HTMLIFrameElement | null {
  return document.getElementById('histfzf-overlay-frame') as HTMLIFrameElement | null
}

function postFromOverlay(msg: unknown, origin: string): void {
  // The relay receives messages the overlay posts to its parent — in
  // jsdom the overlay's window IS this window (iframe src resolved by
  // the browser, not jsdom), so dispatching at the window emulates it.
  window.dispatchEvent(new MessageEvent('message', { origin, data: msg }))
}

test('relay is bound once and rebound on re-injection (no double routing)', () => {
  onExecute() // mount
  onExecute() // toggle → close; the relay rebinds to the live frame
  postFromOverlay(
    { type: 'NAVIGATE', url: 'https://example.com/target', newTab: true },
    ORIGIN,
  )
  // Exactly one OPEN_NEW_TAB — a duplicated relay would send it twice.
  const sent = harness.callLog.filter((c) => c.kind === 'runtime.sendMessage')
  expect(sent).toHaveLength(1)
  expect((sent[0].args as { type: string }).type).toBe('OPEN_NEW_TAB')
})

test('message gate: non-extension-origin events never act', () => {
  onExecute()
  // The observable path is used on purpose: a same-tab NAVIGATE routes
  // to location.assign, which jsdom swallows as a noop — an origin-gate
  // regression would be invisible there. newTab routes through the SW
  // message, so a dropped oracle origin check shows up as a send.
  postFromOverlay(
    { type: 'NAVIGATE', url: 'https://page.example', newTab: true },
    'https://evil.example',
  )
  expect(harness.callLog.filter((c) => c.kind === 'runtime.sendMessage')).toEqual([])
})

test('onExecute mounts the iframe with the exact delivery contract', () => {
  onExecute()
  const frame = getOverlayFrame()
  expect(frame).not.toBeNull()
  expect(frame?.src).toBe(OVERLAY_URL)
  expect(frame?.style.display).toBe('block')
  expect(frame?.style.position).toBe('fixed')
  expect(frame?.style.zIndex).toBe('2147483647')
  expect(frame?.style.background).toBe('transparent')
})

test('re-injection toggles visibility both ways (open → close → open)', () => {
  onExecute()
  expect(getOverlayFrame()?.style.display).toBe('block')
  onExecute()
  expect(getOverlayFrame()?.style.display).toBe('none')
  onExecute()
  expect(getOverlayFrame()?.style.display).toBe('block')
})

test('NAVIGATE new tab relays a validated OPEN_NEW_TAB to the SW', () => {
  onExecute()
  postFromOverlay(
    { type: 'NAVIGATE', url: 'https://example.com/target', newTab: true },
    ORIGIN,
  )
  const sent = harness.callLog.filter((c) => c.kind === 'runtime.sendMessage')
  expect(sent).toHaveLength(1)
  expect((sent[0].args as { type: string; url: string }).type).toBe('OPEN_NEW_TAB')
  expect((sent[0].args as { type: string; url: string }).url).toBe('https://example.com/target')
})

test('CLOSE hides the iframe without unmounting it', () => {
  onExecute()
  postFromOverlay({ type: 'CLOSE' }, ORIGIN)
  const frame = getOverlayFrame()
  expect(frame?.style.display).toBe('none') // hidden
  expect(frame).not.toBeNull() // still mounted → cold start preserved
  onExecute() // next injection shows it again
  expect(frame?.style.display).toBe('block')
})

test('state persists across re-injection within the same page lifetime', () => {
  onExecute()
  onExecute() // close
  const frame = getOverlayFrame()
  expect((window as unknown as { __histFzfOpen?: boolean }).__histFzfOpen).toBe(false)
  expect(frame?.style.display).toBe('none')
  onExecute() // reopen
  expect((window as unknown as { __histFzfOpen?: boolean }).__histFzfOpen).toBe(true)
})
