import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// ============================================================================
// React context menu. <ContextMenuProvider> renders a single floating menu;
// useContextMenu().open(clientX, clientY, items) shows it from anywhere.
// ============================================================================

export interface MenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
  hint?: string;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

interface MenuApi {
  open: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
}

const Ctx = createContext<MenuApi | null>(null)

export function useContextMenu (): MenuApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('useContextMenu must be used within <ContextMenuProvider>')
  return api
}

export function ContextMenuProvider ({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const open = useCallback((x: number, y: number, items: MenuItem[]) => {
    setState({ x, y, items })
    setPos({ x, y })
  }, [])
  const close = useCallback(() => {
    setState(null)
    setPos(null)
  }, [])

  // clamp to viewport once measured
  useEffect(() => {
    if (!state || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = Math.max(4, Math.min(state.x, window.innerWidth - rect.width - 8))
    const y = Math.max(4, Math.min(state.y, window.innerHeight - rect.height - 8))
    setPos({ x, y })
  }, [state])

  // close on outside interaction
  useEffect(() => {
    if (!state) return
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const id = window.setTimeout(() => {
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('wheel', close, true)
      window.addEventListener('resize', close, true)
    }, 0)
    return () => {
      clearTimeout(id)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('resize', close, true)
    }
  }, [state, close])

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {state && pos && (
        <div ref={ref} className='context-menu' role='menu' style={{ left: pos.x, top: pos.y }}>
          {state.items.map((it, i) =>
            it.separator
              ? (
                <div key={i} className='ctx-sep' />
                )
              : (
                <button
                  key={i}
                  className={'ctx-item' + (it.danger ? ' danger' : '')}
                  disabled={it.disabled}
                  onClick={() => {
                    close()
                    it.action?.()
                  }}
                >
                  <span>{it.label}</span>
                  {it.hint && <span className='ctx-hint'>{it.hint}</span>}
                </button>
                )
          )}
        </div>
      )}
    </Ctx.Provider>
  )
}
