// ============================================================================
// graph-grammar-react , public API barrel.
//
// React bindings for the `graph-grammar` engine: a complete, embeddable visual
// editor plus the building blocks to compose your own.
//
//   import { Workbench, AppState } from "graph-grammar-react";
//   import "graph-grammar-react/styles.css";
//
//   const app = new AppState();
//   <Workbench app={app} />
//
// For finer-grained embedding, use the building blocks under your own
// `AppProvider` (e.g. just <GraphCanvas /> or <RuleEditor />).
//
// The engine itself is re-exported below, so embedders can `import { rule, ... }`
// straight from this package without also depending on `graph-grammar`.
// ============================================================================

// --- the complete editor ----------------------------------------------------
export { Workbench } from './Workbench.tsx'
export type { WorkbenchProps } from './Workbench.tsx'

// --- examples (for the `examples` prop; build a custom set or drop them) -----
export { EXAMPLES, buildExample, type ExampleEntry } from 'graph-grammar/examples'

// --- controller -------------------------------------------------------------
export { AppState } from './state.ts'
export type { AppEvent, AppSnapshot } from './state.ts'

// --- undo/redo history (Zustand store + the controls component) -------------
export { useHistory, type HistoryState, type HistoryEntry } from './history.ts'
export { HistoryControls } from './components/HistoryControls.tsx'

// --- custom node rendering --------------------------------------------------
export type { NodeStyle, NodeStyleResolver } from './nodeStyle.ts'

// --- context & hooks --------------------------------------------------------
export { AppProvider, useApp, useAppEvent } from './AppContext.tsx'
export { ContextMenuProvider, useContextMenu } from './components/ContextMenu.tsx'

// --- building-block components ----------------------------------------------
export { Header } from './components/Header.tsx'
export { MenuBar } from './components/MenuBar.tsx'
export type { MenuBarProps } from './components/MenuBar.tsx'
export { GraphCanvas } from './components/graph/GraphCanvas.tsx'
export { RuleEditor } from './components/editor/RuleEditor.tsx'
export { RuleList } from './components/rules/RuleList.tsx'
export { ControlPanel } from './components/controls/ControlPanel.tsx'
export { RunControls } from './components/controls/RunControls.tsx'
export { StrategyConfig } from './components/controls/StrategyConfig.tsx'
export { Stats } from './components/controls/Stats.tsx'
export { ExampleGallery } from './components/controls/ExampleGallery.tsx'
export type { ExampleGalleryProps } from './components/controls/ExampleGallery.tsx'
export { DataPanel } from './components/controls/DataPanel.tsx'
