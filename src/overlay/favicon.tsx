import { useState } from 'react'

/** Chrome's MV3 favicon endpoint — served for the tiny `favicon`
 * permission, reachable from our extension-origin page. */
export function faviconUrl(rawUrl: string): string {
  return chrome.runtime.getURL(
    `_favicon/?pageUrl=${encodeURIComponent(rawUrl)}&size=32`,
  )
}

function Globe(): React.ReactElement {
  return (
    <span className="hf-row__favicon hf-row__favicon--globe" title="">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="8" cy="8" r="6" />
        <ellipse cx="8" cy="8" rx="2.6" ry="6" />
        <path d="M2.4 6 h11.2 M2.4 10 h11.2" />
      </svg>
    </span>
  )
}

/** Favicon with the globe fallback — one <img> that swaps to a generic
 * globe on error (sites Chrome has no icon for). Errors are cheap and
 * transient; no retries, no caching. */
export function Favicon({ rawUrl }: { rawUrl: string }): React.ReactElement {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return <Globe />
  }
  return (
    <img
      className="hf-row__favicon"
      src={faviconUrl(rawUrl)}
      onError={() => setFailed(true)}
      alt=""
      draggable={false}
    />
  )
}
