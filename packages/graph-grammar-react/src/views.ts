import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================================
// Saved filter "views" — named snapshots of the graph filter (which node / edge
// labels are switched off, plus the re-spread flag) so a user can flip between
// curated lenses on the same graph in one click. A Zustand store (the house
// default for client state) persisted to localStorage, so views survive reloads.
// The store owns only the saved presets; applying one is the caller's job (it
// drives the existing filter setters), and matching the current filter to a saved
// view for the "active" highlight is derived, not stored.
// ============================================================================

export interface FilterState {
  hiddenNodes: string[];
  hiddenEdges: string[];
  respread: boolean;
}

export interface SavedView extends FilterState {
  id: string;
  name: string;
}

interface ViewsState {
  views: SavedView[];
  /** Save the given filter under `name`; returns the new view's id. */
  save: (name: string, filter: FilterState) => string;
  /** Overwrite an existing view's captured filter. */
  update: (id: string, filter: FilterState) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `v_${Math.random().toString(36).slice(2)}`)

export const useViews = create<ViewsState>()(
  persist(
    (set) => ({
      views: [],

      save: (name, filter) => {
        const id = newId()
        const view: SavedView = { id, name, ...filter }
        set((s) => ({ views: [...s.views, view] }))
        return id
      },

      update: (id, filter) =>
        set((s) => ({ views: s.views.map((v) => (v.id === id ? { ...v, ...filter } : v)) })),

      rename: (id, name) =>
        set((s) => ({ views: s.views.map((v) => (v.id === id ? { ...v, name } : v)) })),

      remove: (id) => set((s) => ({ views: s.views.filter((v) => v.id !== id) })),
    }),
    { name: 'gg-graph-views', version: 1 }
  )
)
