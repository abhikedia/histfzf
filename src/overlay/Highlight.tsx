import { useMemo } from 'react'
import { segmentMatches } from './search'

/**
 * Renders one text segment (a line on a result row) with matched
 * characters emphasized: bold + full white, the rest at the parent's
 * dimmed color. `positions` are haystack indices; `offset` is where
 * this segment starts in the haystack (0 for the title, titleLen for
 * the URL). A segment with no matches renders plain.
 */
export default function Highlight({
  text,
  positions,
  offset,
}: {
  text: string
  positions: ReadonlySet<number>
  offset: number
}) {
  const matched = useMemo(
    () => segmentMatches(text, positions, offset),
    [text, positions, offset],
  )

  if (matched.size === 0) {
    return <>{text}</>
  }

  const parts: Array<{ text: string; match: boolean }> = []
  let current = ''
  let currentMatch = matched.has(0)
  for (let i = 0; i < text.length; i++) {
    const m = matched.has(i)
    if (m !== currentMatch) {
      parts.push({ text: current, match: currentMatch })
      current = ''
      currentMatch = m
    }
    current += text[i]
  }
  parts.push({ text: current, match: currentMatch })

  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <b className="hf-hl" key={i}>
            {part.text}
          </b>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
