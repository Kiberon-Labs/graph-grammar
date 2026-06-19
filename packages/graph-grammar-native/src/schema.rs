use crate::types::ApiError;
use serde_json::Value;

// ============================================================================
// Schema validation ,the single contract. `schema/graph-grammar.schema.json`
// is generated from the engine's zod schemas (scripts/emit-schema.ts) and
// embedded here, so the native port validates input against the SAME contract
// the TS engine enforces on import rather than silently accepting partial data.
//
// (The zod→JSON-Schema→serde *type-gen* path was evaluated and rejected for the
// working types: typify emits `setProps` as an unordered HashMap ,which would
// break the RNG draw-order parity ,plus anonymous newtypes. So the schema is
// enforced by validation here while the working structs stay hand-written; the
// conformance suite is the behavioural guard and `emit-schema.ts --check` keeps
// the committed schema in lockstep with the zod source.)
// ============================================================================

pub(crate) mod schema_check {
    use crate::types::ApiError;
    use jsonschema::Validator;
    use serde_json::{json, Value};
    use std::sync::OnceLock;

    const SCHEMA_SRC: &str = include_str!("../schema/graph-grammar.schema.json");

    fn doc() -> &'static Value {
        static D: OnceLock<Value> = OnceLock::new();
        D.get_or_init(|| serde_json::from_str(SCHEMA_SRC).expect("embedded schema parses"))
    }

    /// A validator for the whole document (`def = None`) or one of its `$defs`.
    fn build(def: Option<&str>) -> Validator {
        let schema = match def {
            None => doc().clone(),
            Some(name) => json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "$ref": format!("#/$defs/{name}"),
                "$defs": doc().get("$defs").cloned().unwrap_or_else(|| json!({})),
            }),
        };
        jsonschema::validator_for(&schema).expect("embedded schema compiles")
    }

    pub fn grammar() -> &'static Validator {
        static V: OnceLock<Validator> = OnceLock::new();
        V.get_or_init(|| build(None))
    }
    pub fn rule() -> &'static Validator {
        static V: OnceLock<Validator> = OnceLock::new();
        V.get_or_init(|| build(Some("Rule")))
    }
    pub fn graph() -> &'static Validator {
        static V: OnceLock<Validator> = OnceLock::new();
        V.get_or_init(|| build(Some("Graph")))
    }

    /// Validate `value`, returning a concise ApiError (code 1) on failure.
    pub fn check(value: &Value, validator: &Validator, what: &str) -> Result<(), ApiError> {
        let errors: Vec<String> = validator
            .iter_errors(value)
            .take(4)
            .map(|e| format!("{e} (at {})", e.instance_path()))
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(ApiError { code: 1, detail: format!("invalid {what}: {}", errors.join("; ")) })
        }
    }
}

/// Parse JSON, validate it against `validator`, then deserialize into `T`.
pub(crate) fn parse_validated<T: serde::de::DeserializeOwned>(
    json: &str,
    validator: &jsonschema::Validator,
    what: &str,
) -> Result<T, ApiError> {
    let value: Value = serde_json::from_str(json)
        .map_err(|e| ApiError { code: 1, detail: format!("invalid {what} JSON: {e}") })?;
    schema_check::check(&value, validator, what)?;
    serde_json::from_value(value).map_err(|e| ApiError { code: 1, detail: format!("{what}: {e}") })
}
