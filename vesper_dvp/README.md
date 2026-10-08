# vesper_dvp

Quasar-based Solana program for Vesper primary issuance settlement:

- atomic delivery-versus-payment from the offering vault to the buyer
- authority-approved settlement so direct buyer calls cannot bypass prepared-order controls
- one-time 90-bps platform fee charged with principal to the canonical treasury
- Token-2022 property token support
- SPL Token mock USDC payment support
- frozen-at-rest Token-2022 custody: settlement atomically thaws, delivers, and refreezes

The program id remains:

```text
CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2
```

## Layout

| Path | Purpose |
|------|---------|
| `src/lib.rs` | Quasar program entrypoint and instruction dispatch |
| `src/instructions/` | Instruction account structs and handlers |
| `src/state.rs` | `Offering` and `Eligibility` account layouts |
| `src/token_acl_cpi.rs` | Local Token-2022 freeze/thaw CPI builders |
| `tests/runtime.rs` | Root Cargo integration target exposing each exploit-path runtime test |
| `runtime-tests/` | Isolated QuasarSVM harness for the built ELF |
| `Quasar.toml` | Quasar project config |
| `target/idl/vesper_dvp.idl.json` | Generated Quasar IDL after `quasar build` |
| `target/client/rust/vesper_dvp-client/` | Generated Rust client after `quasar build` |

## Commands

```bash
NO_DNA=1 quasar build
NO_DNA=1 cargo test
NO_DNA=1 cargo clippy --all-targets -- -D warnings
```

`cargo test` runs the normal program tests plus eleven named integration tests. Each integration test
delegates to the isolated `runtime-tests` crate because current `quasar-lang` and `quasar-svm`
require incompatible `solana-address` versions when linked into one Cargo dependency graph.

The fee is computed from the principal in 6-decimal payment-mint base units using checked `u128`
intermediates, then rounded half-up to the nearest payment cent (10,000 base units). The exact total
is `principal + rounded fee`; the annual management fee remains inside net yield and is not charged
again during settlement.

Settlement requires both buyer and `offering.authority` signatures. The TypeScript client exposes
`applyPlatformSettlementAuthorization`, which has no local-key fallback and fails closed until a
production custody/signer provider is configured with the offering authority credential.

Property mint authority must be revoked before initialization. The initialized supply must equal the
offering total and the vault must hold that entire supply. Holder accounts remain frozen at rest;
the legacy public `thaw` discriminator is retained for ABI compatibility but always fails.

## Release blocker: chain configuration

The repository does not define an approved platform authority or canonical production payment mint.
The program therefore cannot yet bind `initializeOffering` to those identities without inventing
keys. Do not deploy this artifact to production until a governed chain-config design is ratified and
implemented (including bootstrap authority, rotation/recovery policy, and cluster-specific payment
mint). The devnet scripts intentionally create a mock six-decimal payment mint and are proof tools,
not production configuration.

`quasar build` emits the deployable program at `target/deploy/vesper_dvp.so`.
After rebuilding, copy the generated IDL into the app client:

```bash
cp target/idl/vesper_dvp.idl.json ../app/lib/solana/vesper_dvp.idl.json
```

## ABI Notes

Quasar uses one-byte discriminators in this program:

| Item | Discriminator |
|------|---------------|
| `initializeOffering` | `0` |
| `settlePurchase` | `1` |
| `setEligibility` | `2` |
| `thaw` | `3` |
| `freeze` | `4` |
| `setOfferingClosed` | `5` |
| `Offering` account | `1` |
| `Eligibility` account | `2` |

The app-side wrapper in `../app/lib/solana/dvp.ts` must stay aligned with the generated IDL. The focused tests in `../app/lib/solana/dvp.test.ts` lock down discriminator values, Offering decode offset, settlement authority, quote rounding, event evidence, and Token-ACL account order.
