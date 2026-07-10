# vesper_dvp

Quasar-based Solana program for Vesper primary issuance settlement:

- atomic delivery-versus-payment from the offering vault to the buyer
- Token-2022 property token support
- SPL Token mock USDC payment support
- Token-ACL eligibility attestations for frozen-by-default property accounts

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
| `Quasar.toml` | Quasar project config |
| `target/idl/vesper_dvp.idl.json` | Generated Quasar IDL after `quasar build` |
| `target/client/rust/vesper_dvp-client/` | Generated Rust client after `quasar build` |

## Commands

```bash
cargo test --features idl-build --no-run
quasar build
```

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
| `Offering` account | `1` |
| `Eligibility` account | `2` |

The app-side wrapper in `../app/lib/solana/dvp.ts` must stay aligned with the generated IDL. The focused tests in `../app/lib/solana/dvp.test.ts` lock down discriminator values, Offering decode offset, and Token-ACL account order.
