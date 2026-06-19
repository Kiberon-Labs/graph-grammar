//! Build script. Under the `generate-header` feature it regenerates the C header
//! (`include/graph_grammar.h`) from the `#[no_mangle] extern "C"` surface of
//! `src/lib.rs` via cbindgen. The feature is OFF by default so plain `cargo
//! build`, downstream Rust consumers, docs.rs, and `cargo publish` never compile
//! cbindgen or modify the (packaged) source tree — the committed header is the
//! source of truth. Regenerate it with `cargo build --features generate-header`.
//! A cbindgen failure is non-fatal (warns only) so the library still builds.

#[cfg(feature = "generate-header")]
fn main() {
    use std::path::Path;

    let crate_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let out = Path::new(&crate_dir).join("include").join("graph_grammar.h");
    if let Some(parent) = out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match cbindgen::generate(&crate_dir) {
        Ok(bindings) => {
            bindings.write_to_file(&out);
            println!("cargo:rerun-if-changed=src/lib.rs");
            println!("cargo:rerun-if-changed=cbindgen.toml");
        }
        Err(e) => {
            println!("cargo:warning=cbindgen header generation skipped: {e}");
        }
    }
}

#[cfg(not(feature = "generate-header"))]
fn main() {}
