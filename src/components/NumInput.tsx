import { useState } from 'react'

/**
 * Numeric input that can be cleared and retyped freely: while focused it keeps
 * a local text draft, and the parsed value is committed only on blur / Enter.
 * Half-typed numbers ("-", "2" on the way to "-20") therefore never reach the
 * store, so positions and building sizes don't jump around mid-keystroke.
 */
export function NumInput({
  value,
  onCommit,
  min,
  max,
  step,
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    setDraft(null)
    const v = parseFloat(raw)
    if (!Number.isNaN(v) && v !== value) onCommit(v)
  }
  return (
    <input
      type="number"
      value={draft ?? String(Number(value.toFixed(2)))}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
