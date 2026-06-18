import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

// A classic menu-bar dropdown: a labelled button that toggles a floating list of
// items. Click-outside / Escape closes it; selecting an item closes it too (via
// the close context the items consume). Used by <MenuBar>.

const MenuCloseCtx = createContext<() => void>(() => {})

export function Menu ({ label, children, align = 'left' }: { label: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className='menu' ref={ref}>
      <button className={'menu-btn' + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className={'menu-dropdown' + (align === 'right' ? ' align-right' : '')} role='menu'>
          <MenuCloseCtx.Provider value={() => setOpen(false)}>{children}</MenuCloseCtx.Provider>
        </div>
      )}
    </div>
  )
}

export function MenuItem ({
  icon,
  label,
  hint,
  onClick,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const close = useContext(MenuCloseCtx)
  return (
    <button
      className={'menu-item' + (danger ? ' danger' : '')}
      role='menuitem'
      disabled={disabled}
      onClick={() => {
        close()
        onClick()
      }}
    >
      {icon && <span className='mi-icon'>{icon}</span>}
      <span className='mi-label'>{label}</span>
      {hint && <span className='mi-hint'>{hint}</span>}
    </button>
  )
}

export function MenuSeparator () {
  return <div className='menu-sep' />
}

export function MenuHeading ({ children }: { children: ReactNode }) {
  return <div className='menu-heading'>{children}</div>
}
