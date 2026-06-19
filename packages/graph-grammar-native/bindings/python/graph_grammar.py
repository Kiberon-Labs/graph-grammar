"""
Python binding for the graph-grammar native library via ctypes.

This is both a reusable thin wrapper (`GraphGrammar`) and a runnable conformance
check that loads the real .dll, applies the relabel fixture, and compares the
result with the TypeScript engine's expected output.

    python bindings/python/graph_grammar.py

The .dll is located via the GG_DLL env var, else by walking up to
`target/debug/graph_grammar.dll`.
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
from pathlib import Path


def _find_dll() -> str:
    env = os.environ.get("GG_DLL")
    if env:
        return env
    names = {
        "win32": "graph_grammar.dll",
        "darwin": "libgraph_grammar.dylib",
    }
    name = names.get(sys.platform, "libgraph_grammar.so")
    for base in [Path(__file__).resolve(), *Path(__file__).resolve().parents]:
        cand = base / "target" / "debug" / name
        if cand.exists():
            return str(cand)
    raise FileNotFoundError(
        f"could not find {name}; build with `cargo build` or set GG_DLL"
    )


class GraphGrammar:
    """Thin ctypes wrapper over the C ABI."""

    def __init__(self, dll_path: str | None = None):
        self._lib = ctypes.CDLL(dll_path or _find_dll())

        self._lib.gg_version.restype = ctypes.c_char_p
        self._lib.gg_version.argtypes = []

        self._lib.gg_apply_rule.restype = ctypes.c_int
        self._lib.gg_apply_rule.argtypes = [
            ctypes.c_char_p,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]

        self._lib.gg_apply_rule_seeded.restype = ctypes.c_int
        self._lib.gg_apply_rule_seeded.argtypes = [
            ctypes.c_char_p,
            ctypes.c_char_p,
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_void_p),
        ]

        self._lib.gg_engine_new.restype = ctypes.c_void_p
        self._lib.gg_engine_new.argtypes = [
            ctypes.c_char_p,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        self._lib.gg_engine_run.restype = ctypes.c_int
        self._lib.gg_engine_run.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
        self._lib.gg_engine_graph.restype = ctypes.c_int
        self._lib.gg_engine_graph.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        self._lib.gg_engine_free.restype = None
        self._lib.gg_engine_free.argtypes = [ctypes.c_void_p]

        self._lib.gg_string_free.restype = None
        self._lib.gg_string_free.argtypes = [ctypes.c_void_p]

    def _take(self, ptr: ctypes.c_void_p) -> dict:
        raw = ctypes.cast(ptr, ctypes.c_char_p).value or b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        finally:
            self._lib.gg_string_free(ptr)

    def run_grammar(self, grammar: dict, max_steps: int = -1) -> tuple[int, dict]:
        """Build an engine, run it to a fixpoint/bound, return (applied, graph)."""
        err = ctypes.c_void_p()
        eng = self._lib.gg_engine_new(json.dumps(grammar).encode("utf-8"), None, ctypes.byref(err))
        if not eng:
            raise RuntimeError(f"engine_new failed: {self._take(err)}")
        try:
            out = ctypes.c_void_p()
            self._lib.gg_engine_run(eng, max_steps, ctypes.byref(out))
            applied = self._take(out).get("applied", -1)
            gout = ctypes.c_void_p()
            self._lib.gg_engine_graph(eng, ctypes.byref(gout))
            return applied, self._take(gout)
        finally:
            self._lib.gg_engine_free(eng)

    def version(self) -> str:
        return self._lib.gg_version().decode("utf-8")

    def apply_rule(self, rule: dict, graph: dict, seed: int | None = None) -> tuple[int, dict]:
        """Apply one rule to one graph. With a seed, takes the stochastic path.
        Returns (code, result_dict)."""
        out = ctypes.c_void_p()
        rule_b = json.dumps(rule).encode("utf-8")
        graph_b = json.dumps(graph).encode("utf-8")
        if seed is None:
            code = self._lib.gg_apply_rule(rule_b, graph_b, ctypes.byref(out))
        else:
            code = self._lib.gg_apply_rule_seeded(rule_b, graph_b, seed, ctypes.byref(out))
        try:
            raw = ctypes.cast(out, ctypes.c_char_p).value or b"{}"
            return code, json.loads(raw.decode("utf-8"))
        finally:
            self._lib.gg_string_free(out)


def _graphs_equiv(got: dict, want: dict) -> bool:
    """Compare two graphs up to id-renaming of created elements (the engine's
    uid() is volatile). Both sides apply the same ops in the same order, so the
    node/edge lists line up positionally; x/y are ignored."""
    gn, wn = got.get("nodes", []), want.get("nodes", [])
    if len(gn) != len(wn):
        return False
    id_map = {}
    for a, b in zip(gn, wn):
        if a.get("label") != b.get("label") or a.get("props", {}) != b.get("props", {}):
            return False
        id_map[a["id"]] = b["id"]
    ge, we = got.get("edges", []), want.get("edges", [])
    if len(ge) != len(we):
        return False
    for a, b in zip(ge, we):
        if a.get("label") != b.get("label") or a.get("directed") != b.get("directed") or a.get("props", {}) != b.get("props", {}):
            return False
        if id_map.get(a["source"]) != b["source"] or id_map.get(a["target"]) != b["target"]:
            return False
    return True


def _main() -> int:
    fixtures = None
    for base in Path(__file__).resolve().parents:
        cand = base / "conformance" / "fixtures"
        if cand.is_dir():
            fixtures = cand
            break
    if fixtures is None:
        print("FAIL: could not locate conformance/fixtures", file=sys.stderr)
        return 1

    gg = GraphGrammar()
    print(f"graph-grammar version: {gg.version()}")

    names = sorted(p.name[: -len(".input.json")] for p in fixtures.glob("*.input.json"))
    if not names:
        print("FAIL: no fixtures found", file=sys.stderr)
        return 1

    failures = 0
    for name in names:
        inp = json.loads((fixtures / f"{name}.input.json").read_text(encoding="utf-8"))
        expected = json.loads((fixtures / f"{name}.expected.json").read_text(encoding="utf-8"))

        if "grammar" in inp:  # multi-step engine run
            applied, graph = gg.run_grammar(inp["grammar"])
            if not _graphs_equiv(graph, expected):
                print(f"FAIL [{name}]: engine run diverged", file=sys.stderr)
                failures += 1
                continue
            if "applied" in expected and applied != expected["applied"]:
                print(f"FAIL [{name}]: applied {applied} != {expected['applied']}", file=sys.stderr)
                failures += 1
                continue
            print(f"PASS [{name}]: native engine run matches the TypeScript engine.")
            continue

        code, result = gg.apply_rule(inp["rule"], inp["graph"], inp.get("seed"))
        if code != 0:
            print(f"FAIL [{name}]: code {code}: {result}", file=sys.stderr)
            failures += 1
            continue
        if not result.get("applied"):
            print(f"FAIL [{name}]: rule did not apply", file=sys.stderr)
            failures += 1
            continue

        if not _graphs_equiv(result["graph"], expected):
            print(f"FAIL [{name}]: diverged", file=sys.stderr)
            failures += 1
            continue
        print(f"PASS [{name}]: native DLL output matches the TypeScript engine.")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_main())
