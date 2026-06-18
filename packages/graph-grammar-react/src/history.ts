import { create } from 'zustand'
import type { AppSnapshot } from './state.ts'

// ============================================================================
// Undo/redo history , a Zustand store (the house default for client state going
// forward). It tracks the *actions* the user takes as a linear timeline of
// labelled snapshots: `record` appends after each tracked edit, `undo`/`redo`
// walk the timeline and hand back the snapshot to restore. A fresh edit after
// an undo truncates the redo branch, rapid same-action edits coalesce, and the
// timeline is capped so memory stays bounded.
//
// The store owns only history bookkeeping; AppState owns the domain model and
// performs the actual snapshot()/restore(). HistoryControls wires the two.
// ============================================================================

export interface HistoryEntry {
  /** Short action label, e.g. "Add node", "Edit rule", "Load …". */
  label: string;
  snapshot: AppSnapshot;
}

const CAP = 80 // most-recent entries kept
const COALESCE_MS = 550 // rapid same-action edits fold into one entry

export interface HistoryState {
  entries: HistoryEntry[];
  index: number; // pointer to the current entry (the present)
  lastTs: number;
  /** Seed the timeline with the initial state (clears any prior history). */
  init: (snapshot: AppSnapshot) => void;
  /** Append (or coalesce) a new state produced by `label`. */
  record: (label: string, snapshot: AppSnapshot) => void;
  /** Step back; returns the snapshot to restore, or null at the start. */
  undo: () => AppSnapshot | null;
  /** Step forward; returns the snapshot to restore, or null at the tip. */
  redo: () => AppSnapshot | null;
}

export const useHistory = create<HistoryState>((set, get) => ({
  entries: [],
  index: -1,
  lastTs: 0,

  init: (snapshot) => set({ entries: [{ label: 'Initial state', snapshot }], index: 0, lastTs: 0 }),

  record: (label, snapshot) => {
    const { entries, index, lastTs } = get()
    const now = Date.now()
    // Coalesce: a rapid repeat of the same action at the tip updates in place
    // (so typing a label or nudging a slider is a single undo step).
    if (index >= 0 && index === entries.length - 1 && entries[index].label === label && now - lastTs < COALESCE_MS) {
      const next = entries.slice()
      next[index] = { label, snapshot }
      set({ entries: next, lastTs: now })
      return
    }
    // Otherwise truncate any redo branch and push the new entry (capped).
    let next = entries.slice(0, index + 1)
    next.push({ label, snapshot })
    if (next.length > CAP) next = next.slice(next.length - CAP)
    set({ entries: next, index: next.length - 1, lastTs: now })
  },

  undo: () => {
    const { entries, index } = get()
    if (index <= 0) return null
    const i = index - 1
    set({ index: i, lastTs: 0 })
    return entries[i].snapshot
  },

  redo: () => {
    const { entries, index } = get()
    if (index >= entries.length - 1) return null
    const i = index + 1
    set({ index: i, lastTs: 0 })
    return entries[i].snapshot
  },
}))

// --- selectors (small helpers for components) -------------------------------
export const selectCanUndo = (s: HistoryState): boolean => s.index > 0
export const selectCanRedo = (s: HistoryState): boolean => s.index < s.entries.length - 1
/** Label of the action that would be undone (the current entry). */
export const selectUndoLabel = (s: HistoryState): string | null => (s.index > 0 ? s.entries[s.index]?.label ?? null : null)
/** Label of the action that would be redone (the next entry). */
export const selectRedoLabel = (s: HistoryState): string | null =>
  s.index < s.entries.length - 1 ? s.entries[s.index + 1]?.label ?? null : null
