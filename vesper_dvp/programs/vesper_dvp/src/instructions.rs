pub mod initialize_offering;
pub mod settle_purchase;

// Glob re-exports are required by the `#[program]` macro (they surface the generated
// `__client_accounts_*` / `__cpi_client_accounts_*` modules). The only shadowed symbol is each
// module's private `handler`, which is always called by its fully-qualified path in lib.rs.
pub use initialize_offering::*;
pub use settle_purchase::*;
