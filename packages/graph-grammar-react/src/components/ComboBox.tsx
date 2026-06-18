import { useRef, useState } from 'react'

// Sentinel for the "type a custom value" option (won't collide with real data).
const CREATE = 'create'

interface ComboBoxProps {
  /** Current value. */
  value: string;
  /** Known options to choose from. */
  options: string[];
  onChange: (v: string) => void;
  className?: string;
  /** Show a "(none)"-style option that yields "". */
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** Label for the freeform escape hatch. */
  createLabel?: string;
  placeholder?: string;
}

/**
 * A dropdown of known `options` plus a "Create new…/Custom…" entry that swaps in
 * a freeform text input. Lets users pick from an existing set (avoiding typos)
 * while still allowing a brand-new value when they need one. The current value
 * is always selectable even if it isn't in `options` (e.g. a custom entry).
 */
export function ComboBox ({
  value,
  options,
  onChange,
  className,
  allowEmpty,
  emptyLabel = '(none)',
  createLabel = 'Create new…',
  placeholder,
}: ComboBoxProps) {
  const [creating, setCreating] = useState(false)
  const handled = useRef(false)

  const startCreate = () => {
    handled.current = false
    setCreating(true)
  }
  const finishCreate = (raw: string) => {
    if (handled.current) return // guard against Enter-then-blur double fire
    handled.current = true
    setCreating(false)
    const v = raw.trim()
    if (v) onChange(v)
  }

  if (creating) {
    return (
      <input
        className={className}
        autoFocus
        placeholder={placeholder ?? 'Type a value…'}
        defaultValue=''
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            finishCreate(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            handled.current = true
            setCreating(false)
          }
        }}
        onBlur={(e) => finishCreate(e.currentTarget.value)}
      />
    )
  }

  // Make sure a custom current value is still shown as the selected option.
  const opts = [...options]
  if (value && !opts.includes(value)) opts.unshift(value)
  const showEmpty = allowEmpty || value === ''

  return (
    <select
      className={className}
      value={value}
      onChange={(e) => {
        const v = e.target.value
        if (v === CREATE) startCreate()
        else onChange(v)
      }}
    >
      {showEmpty && <option value=''>{allowEmpty ? emptyLabel : '(empty)'}</option>}
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={CREATE}>＋ {createLabel}</option>
    </select>
  )
}
