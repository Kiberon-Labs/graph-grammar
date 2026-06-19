---
title: Using the native library (DLL)
description: Call the graph-grammar engine from C#, Python, C/C++ or any FFI-capable language via the native C-ABI shared library ,no Node runtime required.
---

The engine also ships as a **native shared library** (`.dll` / `.so` / `.dylib`)
with a small C ABI, so you can drive it from C#, Python, C/C++, Go, or any
language with a foreign-function interface ,**without a Node or JavaScript
runtime**. The library reproduces the TypeScript engine's behaviour bit-for-bit,
including seeded randomness.

The wire format is **JSON in, JSON out**: you pass the same `Grammar` / `Rule` /
`Graph` shapes documented in the [API reference](/reference/api/), and get JSON
back. Inputs are validated against the engine's schema at the boundary.

:::note[When to use this instead of the npm package]
Reach for the native library when your application isn't TypeScript/JavaScript,
or when you can't take a Node dependency. If you're already in TS/JS, the
[`graph-grammar`](/getting-started/) npm package is the better fit ,richer
types, the builders DSL, and tree-shaking.
:::

## 1. Download

Grab the archive for your platform from the project's
[GitHub Releases](https://github.com/Kiberon-Labs/graph-grammar/releases)
(assets named `graph-grammar-native-<version>-<platform>`):

| Platform | Asset | Library file |
| --- | --- | --- |
| Windows x64 | `…-windows-x64.zip` | `graph_grammar_native.dll` |
| Linux x64 | `…-linux-x64.tar.gz` | `libgraph_grammar_native.so` |
| macOS (Apple silicon) | `…-macos-arm64.tar.gz` | `libgraph_grammar_native.dylib` |
| macOS (Intel) | `…-macos-x64.tar.gz` | `libgraph_grammar_native.dylib` |

Each archive contains the library, the generated C header
(`graph_grammar.h`), the JSON Schema (`graph-grammar.schema.json`), and the
README. To build from source instead, see
[Building from source](#building-from-source).

## 2. The C ABI

All strings are NUL-terminated UTF-8.

| Function | Purpose |
| --- | --- |
| `const char* gg_version(void)` | Library version. The pointer is owned by the library ,**do not free it**. |
| `int gg_apply_rule(const char* rule_json, const char* graph_json, char** out_json)` | Apply one rule to one graph, deterministically. |
| `int gg_apply_rule_seeded(const char* rule_json, const char* graph_json, uint32_t seed, char** out_json)` | Same, but with a seeded RNG (stochastic match selection + random property expressions). |
| `int gg_string_free(char* s)` | Release a string returned via an `out_json` parameter. |

For multi-step runs, create a stateful engine handle (seeded from the grammar's
`config.seed`):

| Function | Purpose |
| --- | --- |
| `Engine* gg_engine_new(const char* grammar_json, const char* start_graph_json, char** err_out)` | Build an engine. `start_graph_json` may be `NULL` to use the grammar's own `start`. Returns `NULL` and writes `*err_out` on failure. |
| `int gg_engine_step(Engine*, char** out_json)` | Advance one step. |
| `int gg_engine_run(Engine*, int32_t max_steps, char** out_json)` | Run to a fixpoint/bound. Pass `-1` for `max_steps` to use `config.maxSteps`. |
| `int gg_engine_graph(Engine*, char** out_json)` | Snapshot the current graph. |
| `void gg_engine_free(Engine*)` | Release the engine handle. |

### Return codes

Functions return `0` on success. On error they return a non-zero code and write
`{ "error": { "code", "detail" } }` to the out-parameter:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Invalid input JSON, or input that fails schema validation |
| `3` | Unsupported feature (e.g. a random property expression without a seed) |
| `-1` | Null argument or an internal error |

### Result shapes

`gg_apply_rule[_seeded]` writes an envelope:

```json
{
  "applied": true,
  "graph": { "nodes": [], "edges": [] },
  "createdNodes": [], "createdEdges": [],
  "deletedNodes": [], "deletedEdges": []
}
```

`gg_engine_step` writes `{ "applied", "ruleId"?, "createdNodes", … }`,
`gg_engine_run` writes `{ "applied": <count> }`, and `gg_engine_graph` writes
`{ "nodes", "edges" }`.

:::caution[Memory ownership]
Every string written to an `out_json` (or `err_out`) parameter is heap-allocated
by the library and **must be released with `gg_string_free`**. The only exception
is the pointer returned by `gg_version`, which is owned by the library. The
`Engine*` handle must be released exactly once with `gg_engine_free`, and is not
thread-safe ,don't call into the same engine from multiple threads.
:::

## 3. Call it from Python

Using the standard-library `ctypes` ,no third-party packages:

```python
import ctypes, json

lib = ctypes.CDLL("./libgraph_grammar_native.so")  # .dll / .dylib on Win/macOS
lib.gg_apply_rule_seeded.restype = ctypes.c_int
lib.gg_apply_rule_seeded.argtypes = [
    ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p),
]
lib.gg_string_free.argtypes = [ctypes.c_void_p]

def apply_rule(rule: dict, graph: dict, seed: int) -> tuple[int, dict]:
    out = ctypes.c_void_p()
    code = lib.gg_apply_rule_seeded(
        json.dumps(rule).encode(), json.dumps(graph).encode(), seed, ctypes.byref(out),
    )
    try:
        return code, json.loads(ctypes.cast(out, ctypes.c_char_p).value or b"{}")
    finally:
        lib.gg_string_free(out)

rule = {
    "id": "r", "name": "A→B", "enabled": True, "weight": 1, "probability": 1,
    "priority": 0, "maxApplications": 0, "morphism": [], "embedding": [],
    "lhs": {"nodes": [{"id": "L0", "label": "A", "props": {}}], "edges": []},
    "rhs": {"nodes": [{"id": "R0", "label": "B", "props": {}, "mapFrom": "L0"}], "edges": []},
}
graph = {"nodes": [{"id": "n1", "label": "A", "props": {}}], "edges": []}

code, result = apply_rule(rule, graph, seed=42)
print(result["graph"])  # n1 is now labelled "B"
```

## 4. Call it from C#

Using `DllImport`. Marshal JSON as NUL-terminated UTF-8 bytes and read results
back with `Marshal.PtrToStringUTF8`:

```csharp
using System.Runtime.InteropServices;
using System.Text;

static class Gg
{
    const string Lib = "graph_grammar_native"; // resolves to .dll/.so/.dylib

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    static extern int gg_apply_rule_seeded(byte[] rule, byte[] graph, uint seed, out IntPtr outJson);

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
    static extern void gg_string_free(IntPtr s);

    static byte[] Utf8z(string s)
    {
        var b = Encoding.UTF8.GetBytes(s);
        Array.Resize(ref b, b.Length + 1); // trailing NUL
        return b;
    }

    public static (int Code, string Json) ApplyRule(string ruleJson, string graphJson, uint seed)
    {
        var code = gg_apply_rule_seeded(Utf8z(ruleJson), Utf8z(graphJson), seed, out var ptr);
        try { return (code, Marshal.PtrToStringUTF8(ptr) ?? "{}"); }
        finally { gg_string_free(ptr); }
    }
}
```

## 5. Call it from Go

Using [cgo](https://pkg.go.dev/cmd/cgo). The `import "C"` block declares the
functions (or `#include "graph_grammar.h"` from the release archive); `LDFLAGS`
links the shared library. cgo requires a C compiler and `CGO_ENABLED=1`.

```go
package main

/*
#cgo LDFLAGS: -L. -lgraph_grammar_native
#include <stdlib.h>

int  gg_apply_rule_seeded(const char* rule_json, const char* graph_json, unsigned int seed, char** out_json);
void gg_string_free(char* s);
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// applyRule returns the status code and the result JSON. The library owns the
// returned string until gg_string_free, so we copy it out with C.GoString first.
func applyRule(ruleJSON, graphJSON string, seed uint32) (int, string) {
	cRule := C.CString(ruleJSON)
	cGraph := C.CString(graphJSON)
	defer C.free(unsafe.Pointer(cRule))
	defer C.free(unsafe.Pointer(cGraph))

	var out *C.char
	code := C.gg_apply_rule_seeded(cRule, cGraph, C.uint(seed), &out)
	defer C.gg_string_free(out)

	return int(code), C.GoString(out)
}

func main() {
	const ruleJSON = `{
		"id":"r","name":"A->B","enabled":true,"weight":1,"probability":1,
		"priority":0,"maxApplications":0,"morphism":[],"embedding":[],
		"lhs":{"nodes":[{"id":"L0","label":"A","props":{}}],"edges":[]},
		"rhs":{"nodes":[{"id":"R0","label":"B","props":{},"mapFrom":"L0"}],"edges":[]}
	}`
	const graphJSON = `{"nodes":[{"id":"n1","label":"A","props":{}}],"edges":[]}`

	code, result := applyRule(ruleJSON, graphJSON, 42)
	fmt.Println(code, result) // 0  {"applied":true,"graph":{...n1 now labelled "B"...},...}
}
```

:::note[Finding the library at runtime]
`-L.` tells the linker where to find the library at build time; at run time the
OS loader also needs to find it. Put the library next to the binary and set the
loader path (`LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS, or the
working directory / `PATH` on Windows), or install it to a standard location.
:::

## 6. Run a grammar to completion

Use the stateful engine for multi-step runs. In Python:

```python
lib.gg_engine_new.restype = ctypes.c_void_p
lib.gg_engine_new.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
lib.gg_engine_run.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
lib.gg_engine_graph.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
lib.gg_engine_free.argtypes = [ctypes.c_void_p]

def run_grammar(grammar: dict):
    err = ctypes.c_void_p()
    eng = lib.gg_engine_new(json.dumps(grammar).encode(), None, ctypes.byref(err))
    if not eng:
        raise RuntimeError(ctypes.cast(err, ctypes.c_char_p).value)
    try:
        out = ctypes.c_void_p()
        lib.gg_engine_run(eng, -1, ctypes.byref(out))         # -1 → config.maxSteps
        applied = json.loads(ctypes.cast(out, ctypes.c_char_p).value)["applied"]
        lib.gg_string_free(out)
        g = ctypes.c_void_p()
        lib.gg_engine_graph(eng, ctypes.byref(g))
        graph = json.loads(ctypes.cast(g, ctypes.c_char_p).value)
        lib.gg_string_free(g)
        return applied, graph
    finally:
        lib.gg_engine_free(eng)
```

The grammar's `config.strategy` (`random`, `priority`, `sequential`, `maximal`),
`config.seed`, `maxSteps`, and `maxNodes` all behave exactly as in the
[strategies guide](/guides/strategies/).

:::note[Reproducibility]
Seeded runs are deterministic and **match the TypeScript engine bit-for-bit** —
same grammar plus same `config.seed` yields the same sequence of rewrites and the
same final graph, across languages and platforms. The created-element *ids*
differ (they're freshly generated), but the graph structure, labels, and
properties are identical.
:::

## Complete, runnable bindings

The repository ships thin wrappers you can copy or learn from, each exercising
the full ABI against a conformance suite:

- [`bindings/python`](https://github.com/Kiberon-Labs/graph-grammar/tree/master/packages/graph-grammar-native/bindings/python)
- [`bindings/csharp`](https://github.com/Kiberon-Labs/graph-grammar/tree/master/packages/graph-grammar-native/bindings/csharp)

## Building from source

You need the [Rust toolchain](https://rustup.rs). On Windows, the default
`stable-msvc` toolchain links against the Visual Studio C++ build tools.

```sh
cargo build --release --manifest-path packages/graph-grammar-native/Cargo.toml
# → target/release/<lib>  and the generated include/graph_grammar.h
```
