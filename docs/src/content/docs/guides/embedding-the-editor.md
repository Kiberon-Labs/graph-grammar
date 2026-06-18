---
title: Embedding the editor
description: Drop the visual graph-rewriting workbench into your own React app with graph-grammar-react.
---

The `graph-grammar` engine is headless. To get the **visual editor** , the rule
editor and live D3 canvas , install the companion React package
[`graph-grammar-react`](https://www.npmjs.com/package/graph-grammar-react). It
ships the complete workbench as one embeddable component, plus the building
blocks to compose your own UI.

```sh
npm install graph-grammar graph-grammar-react react react-dom
```

`react`/`react-dom` are peer dependencies (v18 or v19). The `graph-grammar` is also a peer dependency so that it can continue to be updated independently of the react frontend

## The whole workbench, one component

```tsx
import { AppState, Workbench } from "graph-grammar-react";
import "graph-grammar-react/styles.css";

const app = new AppState(); // the controller , drives the engine + grammar

export function Editor() {
  return <Workbench app={app} examples={true} />;
}
```

`<Workbench>` renders the full three-pane layout (run controls · rule list ·
tabbed graph canvas / rule editor). The `app` controller is yours to keep a
reference to and drive from the outside.

### Hiding or replacing the header

```tsx
<Workbench app={app} header={false} />      {/* no title bar */}
<Workbench app={app} header={<MyToolbar/>} /> {/* your own */}
```

## Driving it from your app

`AppState` is the integration point. Load a grammar, read the live graph, or
react to changes:

```ts
import { importGrammar, buildExample } from "graph-grammar"; 

app.loadGrammar(buildExample("dungeon")); // or importGrammar(yourJson)
```

## Composing your own layout

For finer control, mount the building blocks yourself under an `AppProvider`
(add `ContextMenuProvider` if you want the right-click menus):

```tsx
import {
  AppState, AppProvider, ContextMenuProvider,
  GraphCanvas, RuleList, ControlPanel,
} from "graph-grammar-react";
import "graph-grammar-react/styles.css";

const app = new AppState();

export function MiniEditor() {
  return (
    <AppProvider app={app}>
      <ContextMenuProvider>
        <div className="my-grid">
          <ControlPanel />
          <RuleList />
          <GraphCanvas active />
        </div>
      </ContextMenuProvider>
    </AppProvider>
  );
}
```

Available building blocks: `GraphCanvas`, `RuleEditor`, `RuleList`,
`ControlPanel`, the individual control panels (`RunControls`, `StrategyConfig`,
`Stats`, `ExampleGallery`, `DataPanel`), `Header`, and the
`useApp()` / `useAppEvent(...events)` hooks.

## Styling

Import the stylesheet once, anywhere in your app:

```ts
import "graph-grammar-react/styles.css";
```

It styles the editor chrome; the graph itself is rendered on a `<canvas>`.

### It won't touch your page

Every rule in the stylesheet is scoped to the editor's own root element
(`.gg-root`, injected by `AppProvider`). The package sets **no** global styles ,
no `html`, `body`, `*`, or bare `button`/`input` rules , so dropping it into an
existing app can't restyle your buttons, reset your box model, or change your
page background. The scope element is `display: contents`, so it adds no box and
can't disturb your layout either.

### Give the container a height

Because the package never styles `html`/`body`, the **full** `<Workbench>` fills
its parent , so give that parent a height:

```tsx
<div style={{ height: "100vh" }}>
  <Workbench app={app} />
</div>
```

(The individual building blocks size to their content / your own layout, so this
only matters for the full workbench.)

## Just the engine?

If you only need to transform graphs programmatically , no UI , install
`graph-grammar` directly and skip this package. See
[Getting started](/getting-started/).
