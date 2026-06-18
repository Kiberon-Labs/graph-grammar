# graph-grammar-react

The embeddable **React editor** for the [`graph-grammar`](https://www.npmjs.com/package/graph-grammar)
engine , a complete visual graph-rewriting workbench (rule editor + live D3
canvas) you can drop into your own app, plus the building blocks to compose your
own UI.

```sh
npm install graph-grammar-react react react-dom graph-grammar
```

> ESM-only. `react`/`react-dom` are peer dependencies (v18 or v19). The
> `graph-grammar` engine is a dependency and is **re-exported**, so you can
> import the engine API straight from this package.

## Embed the whole workbench

```tsx
import { AppState, Workbench } from "graph-grammar-react";
import "graph-grammar-react/styles.css";

const app = new AppState(); // the controller; drives the engine + grammar

export function Editor() {
  return <Workbench app={app} />;
}
```

`<Workbench>` renders the full three-pane editor (run controls · rule list ·
tabbed graph canvas / rule editor). Pass `header={false}` to drop the built-in
title bar when embedding under your own chrome, or `header={<MyBar/>}` to replace
it.

Drive it from the outside via the `app` controller , e.g. load a grammar:

```ts
import { importGrammar } from "graph-grammar-react"; // re-exported from the engine
app.loadGrammar(importGrammar(json));
```

## Compose your own layout

For finer control, mount the building blocks under an `AppProvider` (and
`ContextMenuProvider` if you use the right-click menus):

```tsx
import {
  AppState, AppProvider, ContextMenuProvider,
  GraphCanvas, RuleEditor, RuleList, ControlPanel,
} from "graph-grammar-react";
import "graph-grammar-react/styles.css";

const app = new AppState();

<AppProvider app={app}>
  <ContextMenuProvider>
    <ControlPanel />
    <RuleList />
    <GraphCanvas active />
    {/* or <RuleEditor /> */}
  </ContextMenuProvider>
</AppProvider>
```

Other exports: the `useApp()` / `useAppEvent(...events)` hooks, the individual
control panels (`RunControls`, `StrategyConfig`, `Stats`, `ExampleGallery`,
`DataPanel`), and `Header`.

## Styling

Import the stylesheet once: `import "graph-grammar-react/styles.css"`. It styles
the editor chrome; the graph itself is drawn on a `<canvas>`.

**It won't touch your page.** Every rule is scoped to the editor's own root
element (`.gg-root`, injected by `AppProvider`) , there are no global `html`,
`body`, `*`, or bare `button`/`input` rules, so the stylesheet can't restyle your
app. The scope element is `display: contents`, so it adds no box and can't affect
your layout.

Because the package never styles `html`/`body`, the full `<Workbench>` fills its
parent , give that parent a height:

```tsx
<div style={{ height: "100vh" }}>
  <Workbench app={app} />
</div>
```

## License

MIT
