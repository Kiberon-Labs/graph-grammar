//! Build script: regenerate the C header (`include/graph_grammar.h`) from the
//! `#[no_mangle] extern "C"` surface of `src/lib.rs` on every build via cbindgen.
//! A failure here is non-fatal (warns only) so the library still builds if the
//! header generator is unavailable.

use std::path::Path;

fn main() {
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
