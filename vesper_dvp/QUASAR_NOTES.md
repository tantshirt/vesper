# Quasar Migration Notes

This file tracks Quasar-specific findings from the Vesper port and likely upstream contribution opportunities.

## Local Status

- The active on-chain source is now rooted at `vesper_dvp/src`.
- The old Anchor scaffold was removed so there is one program source of truth.
- `quasar build` succeeds and generates the SBF artifact, IDL, and Rust client.
- `cargo test` discovers and runs the nine exploit-path QuasarSVM cases through the root
  `tests/runtime.rs` integration target.
- The app uses the generated Quasar IDL at `app/lib/solana/vesper_dvp.idl.json`.
- Settlement deployment remains blocked on a configured production signer/custody provider for the
  `offering.authority` partial signature. The client intentionally provides no private-key fallback.

## Upstream Findings

1. `quasar-lang` and `quasar-svm` currently pull an incompatible combined dependency graph.

   `quasar-lang` depends on `solana-address <2.6`, while current `quasar-svm` pulls newer Solana crates that select `solana-address 2.6.x`. The workaround for this repo is `framework = "none"` in `Quasar.toml`.
   Runtime coverage lives in the standalone `runtime-tests` workspace, while nine root integration
   tests invoke those cases so the prescribed `cargo test` command still executes and lists them.

2. The CLI scaffold is stale against current Quasar examples.

   The generated scaffold used `Program<System>`, while the current repo examples use `Program<SystemProgram>`. The Vesper port follows the current examples.

3. `quasar-spl` does not expose freeze/thaw CPI helpers.

   Vesper needs Token-2022 `ThawAccount` and `FreezeAccount` for Token-ACL enforcement. Until upstream adds helpers, `src/token_acl_cpi.rs` builds those instructions locally with SPL Token opcodes `10` and `11`.

4. The installed CLI generated the IDL and Rust client, but not a TypeScript client.

   The app currently maintains a small hand-written TypeScript wrapper around the generated IDL. A generated TypeScript client would remove this manual ABI surface.

## Contribution Candidates

- Add `quasar-spl` helpers for `freeze_account` and `thaw_account`.
- Fix the `quasarsvm-rust` dependency conflict or publish compatible version pins.
- Update the CLI template from `Program<System>` to `Program<SystemProgram>`.
- Document or implement TypeScript client generation from Quasar IDL.
