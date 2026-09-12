import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  readSettings,
  SETTINGS_RANGES,
  writeSettings,
  type HistFzfSettings,
} from '../settings'

const FIELDS: Array<{
  key: keyof HistFzfSettings
  label: string
  hint: string
  suffix?: string
}> = [
  {
    key: 'wf',
    label: 'Frequency weight (Wf)',
    hint: 'How strongly often-visited pages float up',
  },
  {
    key: 'wr',
    label: 'Recency weight (Wr)',
    hint: 'How strongly recently-visited pages float up',
  },
  {
    key: 'halflifeDays',
    label: 'Recency horizon (H)',
    hint: 'Days until a visit loses ~2/3 of its freshness pull',
    suffix: 'days',
  },
  {
    key: 'cap',
    label: 'Frecency cap (B)',
    hint: 'Max boost vs a clearly better match (1 = at most 2x)',
  },
]

export default function App() {
  const [settings, setSettings] = useState<HistFzfSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    readSettings().then((loaded) => {
      if (!cancelled) {
        setSettings(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  function update(key: keyof HistFzfSettings, value: number): void {
    setSettings((previous) => previous && { ...previous, [key]: value })
    setSaved(false)
  }

  async function save(): Promise<void> {
    if (settings === null) {
      return
    }
    await writeSettings(settings)
    setSaved(true)
  }

  async function resetToDefaults(): Promise<void> {
    setSettings({ ...DEFAULT_SETTINGS })
    await writeSettings(DEFAULT_SETTINGS)
    setSaved(true)
  }

  if (settings === null) {
    return <div className="opt-shell"><div className="opt-card opt-loading">Loading…</div></div>
  }

  return (
    <div className="opt-shell">
      <div className="opt-card">
        <div className="opt-head">
          <div
            className="opt-logo"
            aria-hidden="true"
          />
          <div>
            <h1>Ranking weights</h1>
            <p className="opt-intro">
              Matches get a frecency boost:{' '}
              <code>score × (1 + min(Wf·freq + Wr·rec, cap))</code>. Habits
              float up; the cap keeps them from stealing wins from clearly
              better matches. Applies to the palette and the{' '}
              <code>h</code> address-bar keyword on their next open.
            </p>
          </div>
        </div>

        <div className="opt-fields">
          {FIELDS.map((field) => {
            const range = SETTINGS_RANGES[field.key]
            return (
              <div className="opt-field" key={field.key}>
                <div className="opt-field-head">
                  <label htmlFor={field.key}>{field.label}</label>
                  <span className="opt-value">
                    {settings[field.key]}
                    {field.suffix ? ` ${field.suffix}` : ''}
                  </span>
                </div>
                <input
                  id={field.key}
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={settings[field.key]}
                  onChange={(e) => update(field.key, Number(e.target.value))}
                />
                <div className="opt-hint">{field.hint}</div>
              </div>
            )
          })}
        </div>

        <div className="opt-footer">
          <button className="opt-btn" onClick={() => void save()}>
            Save
          </button>
          <button
            className="opt-btn opt-btn--ghost"
            onClick={() => void resetToDefaults()}
          >
            Reset to defaults
          </button>
          <span className={`opt-saved${saved ? ' opt-saved--on' : ''}`}>
            {saved ? 'Saved' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
