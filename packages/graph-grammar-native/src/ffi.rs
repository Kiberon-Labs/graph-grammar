use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::panic::{self, AssertUnwindSafe};
use std::sync::OnceLock;

use crate::api::{apply_rule, apply_rule_seeded};
use crate::engine::{engine_from_json, Engine};
use crate::types::ApiError;

fn error_json(err: &ApiError) -> String {
    format!(
        "{{\"error\":{{\"code\":{},\"detail\":{}}}}}",
        err.code,
        serde_json::to_string(&err.detail).unwrap_or_else(|_| "\"\"".to_string())
    )
}

unsafe fn write_out(out: *mut *mut c_char, s: &str) {
    let c = CString::new(s).unwrap_or_else(|_| CString::new("").unwrap());
    *out = c.into_raw();
}

/// Returns the library version as a static, NUL-terminated C string.
/// The returned pointer is owned by the library; do NOT free it.
#[no_mangle]
pub extern "C" fn gg_version() -> *const c_char {
    static V: OnceLock<CString> = OnceLock::new();
    V.get_or_init(|| CString::new(env!("CARGO_PKG_VERSION")).unwrap()).as_ptr()
}

/// Apply one rule to one graph. `rule_json` and `graph_json` are NUL-terminated
/// UTF-8. On return `*out_json` points to a newly allocated NUL-terminated UTF-8
/// result that the caller MUST release with `gg_string_free`.
///
/// Returns 0 on success (the result envelope), or a non-zero code on error (the
/// result is `{ "error": { code, detail } }`): 1 = bad input JSON,
/// 3 = unsupported feature, -1 = null argument or internal panic.
#[no_mangle]
pub extern "C" fn gg_apply_rule(
    rule_json: *const c_char,
    graph_json: *const c_char,
    out_json: *mut *mut c_char,
) -> i32 {
    if out_json.is_null() {
        return -1;
    }
    if rule_json.is_null() || graph_json.is_null() {
        let err = ApiError { code: 1, detail: "null argument".to_string() };
        unsafe { write_out(out_json, &error_json(&err)) };
        return err.code;
    }

    let result = panic::catch_unwind(|| {
        let rj = unsafe { CStr::from_ptr(rule_json) }
            .to_str()
            .map_err(|_| ApiError { code: 1, detail: "rule_json is not valid UTF-8".to_string() })?;
        let gj = unsafe { CStr::from_ptr(graph_json) }
            .to_str()
            .map_err(|_| ApiError { code: 1, detail: "graph_json is not valid UTF-8".to_string() })?;
        apply_rule(rj, gj)
    });

    match result {
        Ok(Ok(json)) => {
            unsafe { write_out(out_json, &json) };
            0
        }
        Ok(Err(err)) => {
            unsafe { write_out(out_json, &error_json(&err)) };
            err.code
        }
        Err(_) => {
            let err = ApiError { code: -1, detail: "internal panic in gg_apply_rule".to_string() };
            unsafe { write_out(out_json, &error_json(&err)) };
            -1
        }
    }
}

/// Like `gg_apply_rule`, but with a seeded RNG (`seed`, a u32): stochastic match
/// selection and random PropExprs (`randInt`/`randFloat`) are reproduced
/// bit-for-bit against the TypeScript engine for the same seed. Same return-code
/// and ownership contract as `gg_apply_rule`.
#[no_mangle]
pub extern "C" fn gg_apply_rule_seeded(
    rule_json: *const c_char,
    graph_json: *const c_char,
    seed: u32,
    out_json: *mut *mut c_char,
) -> i32 {
    if out_json.is_null() {
        return -1;
    }
    if rule_json.is_null() || graph_json.is_null() {
        let err = ApiError { code: 1, detail: "null argument".to_string() };
        unsafe { write_out(out_json, &error_json(&err)) };
        return err.code;
    }

    let result = panic::catch_unwind(|| {
        let rj = unsafe { CStr::from_ptr(rule_json) }
            .to_str()
            .map_err(|_| ApiError { code: 1, detail: "rule_json is not valid UTF-8".to_string() })?;
        let gj = unsafe { CStr::from_ptr(graph_json) }
            .to_str()
            .map_err(|_| ApiError { code: 1, detail: "graph_json is not valid UTF-8".to_string() })?;
        apply_rule_seeded(rj, gj, seed)
    });

    match result {
        Ok(Ok(json)) => {
            unsafe { write_out(out_json, &json) };
            0
        }
        Ok(Err(err)) => {
            unsafe { write_out(out_json, &error_json(&err)) };
            err.code
        }
        Err(_) => {
            let err = ApiError { code: -1, detail: "internal panic in gg_apply_rule_seeded".to_string() };
            unsafe { write_out(out_json, &error_json(&err)) };
            -1
        }
    }
}

/// Free a string previously returned via an `out_json` out-parameter.
/// Passing NULL is a no-op. Never call this on the `gg_version` pointer.
#[no_mangle]
pub extern "C" fn gg_string_free(s: *mut c_char) {
    if !s.is_null() {
        unsafe { drop(CString::from_raw(s)) };
    }
}

// ---------------------------------------------------------------------------
// Stateful engine handle. `gg_engine_new` returns an opaque `Engine*` that must
// be released exactly once with `gg_engine_free`. The handle is NOT thread-safe:
// don't call into the same engine from multiple threads concurrently.
// ---------------------------------------------------------------------------

/// Create an engine from a grammar (JSON). `start_graph_json` may be NULL to use
/// the grammar's own `start` axiom. On success returns a non-NULL handle; on
/// error returns NULL and, if `err_out` is non-NULL, writes `{ "error": … }` to
/// `*err_out` (release it with `gg_string_free`).
#[no_mangle]
pub extern "C" fn gg_engine_new(
    grammar_json: *const c_char,
    start_graph_json: *const c_char,
    err_out: *mut *mut c_char,
) -> *mut Engine {
    let fail = |err: ApiError| -> *mut Engine {
        if !err_out.is_null() {
            unsafe { write_out(err_out, &error_json(&err)) };
        }
        std::ptr::null_mut()
    };
    if grammar_json.is_null() {
        return fail(ApiError { code: 1, detail: "null grammar_json".to_string() });
    }

    let result = panic::catch_unwind(|| {
        let gj = unsafe { CStr::from_ptr(grammar_json) }
            .to_str()
            .map_err(|_| ApiError { code: 1, detail: "grammar_json is not valid UTF-8".to_string() })?;
        let start = if start_graph_json.is_null() {
            None
        } else {
            Some(
                unsafe { CStr::from_ptr(start_graph_json) }.to_str().map_err(|_| ApiError {
                    code: 1,
                    detail: "start_graph_json is not valid UTF-8".to_string(),
                })?,
            )
        };
        engine_from_json(gj, start)
    });

    match result {
        Ok(Ok(engine)) => Box::into_raw(Box::new(engine)),
        Ok(Err(err)) => fail(err),
        Err(_) => fail(ApiError { code: -1, detail: "internal panic in gg_engine_new".to_string() }),
    }
}

/// Advance the engine one step. Writes the step result
/// (`{ applied, ruleId?, createdNodes, … }`) to `*out_json`. Returns 0, or a
/// non-zero error code (result is `{ "error": … }`). Release `*out_json` with
/// `gg_string_free`.
#[no_mangle]
pub extern "C" fn gg_engine_step(eng: *mut Engine, out_json: *mut *mut c_char) -> i32 {
    if eng.is_null() || out_json.is_null() {
        return -1;
    }
    let engine = unsafe { &mut *eng };
    let result = panic::catch_unwind(AssertUnwindSafe(|| {
        engine.step().map(|sr| serde_json::to_string(&sr).expect("step result serializes"))
    }));
    finish_engine_call(result, out_json, "gg_engine_step")
}

/// Run the engine until no rule applies or a bound is hit. `max_steps`: pass a
/// negative value to use the grammar's `config.maxSteps`. Writes
/// `{ "applied": <count> }` to `*out_json`. Returns 0 or an error code.
#[no_mangle]
pub extern "C" fn gg_engine_run(eng: *mut Engine, max_steps: i32, out_json: *mut *mut c_char) -> i32 {
    if eng.is_null() || out_json.is_null() {
        return -1;
    }
    let engine = unsafe { &mut *eng };
    let ms = if max_steps < 0 { None } else { Some(max_steps as i64) };
    let result = panic::catch_unwind(AssertUnwindSafe(|| {
        engine.run(ms).map(|applied| format!("{{\"applied\":{applied}}}"))
    }));
    finish_engine_call(result, out_json, "gg_engine_run")
}

/// Snapshot the engine's current host graph as `{ nodes, edges }` to `*out_json`.
/// Returns 0 or an error code. Release `*out_json` with `gg_string_free`.
#[no_mangle]
pub extern "C" fn gg_engine_graph(eng: *mut Engine, out_json: *mut *mut c_char) -> i32 {
    if eng.is_null() || out_json.is_null() {
        return -1;
    }
    let engine = unsafe { &*eng };
    let result = panic::catch_unwind(AssertUnwindSafe(|| {
        Ok(serde_json::to_string(&engine.host.to_graph()).expect("graph serializes"))
    }));
    finish_engine_call(result, out_json, "gg_engine_graph")
}

/// Release an engine handle. Passing NULL is a no-op. Using the handle after
/// this is undefined behaviour.
#[no_mangle]
pub extern "C" fn gg_engine_free(eng: *mut Engine) {
    if !eng.is_null() {
        unsafe { drop(Box::from_raw(eng)) };
    }
}

/// Shared tail for the engine FFI calls: serialize success / error / panic.
fn finish_engine_call(
    result: std::thread::Result<Result<String, ApiError>>,
    out_json: *mut *mut c_char,
    what: &str,
) -> i32 {
    match result {
        Ok(Ok(json)) => {
            unsafe { write_out(out_json, &json) };
            0
        }
        Ok(Err(err)) => {
            unsafe { write_out(out_json, &error_json(&err)) };
            err.code
        }
        Err(_) => {
            let err = ApiError { code: -1, detail: format!("internal panic in {what}") };
            unsafe { write_out(out_json, &error_json(&err)) };
            -1
        }
    }
}
