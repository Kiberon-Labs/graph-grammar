import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import { AppState, type AppEvent } from './state.ts'

// ============================================================================
// Bridges the imperative AppState (engine + grammar + pub/sub) into React.
// The engine stays the single source of truth; components subscribe to the
// coarse-grained events they care about and re-read what they need , no state
// duplication, minimal re-renders.
// ============================================================================

const Ctx = createContext<AppState | null>(null)

export function AppProvider ({ app, children }: { app: AppState; children: ReactNode }) {
  // `.gg-root` is the styling scope for the whole editor: every rule in
  // styles.css is prefixed with it, so nothing leaks onto the host page. It is
  // `display: contents`, so it adds no box and cannot affect layout , it exists
  // only to scope selectors and host the CSS variables.
  return (
    <Ctx.Provider value={app}>
      <div className='gg-root'>{children}</div>
    </Ctx.Provider>
  )
}

export function useApp (): AppState {
  const app = useContext(Ctx)
  if (!app) throw new Error('useApp must be used within <AppProvider>')
  return app
}

/**
 * Re-render the calling component whenever any of the given AppState events
 * fire. Returns the AppState for convenience.
 */
export function useAppEvent (...events: AppEvent[]): AppState {
  const app = useApp()
  const [, force] = useReducer((x: number) => x + 1, 0)
  // events are passed as varargs; join for a stable dependency key
  const key = events.join(',')
  useEffect(() => {
    const unsubs = events.map((e) => app.on(e, force))
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, key])
  return app
}
