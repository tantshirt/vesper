use std::process::Command;

fn run_runtime_test(name: &str) {
    let output = Command::new("cargo")
        .args([
            "test",
            "--manifest-path",
            "runtime-tests/Cargo.toml",
            name,
            "--",
            "--exact",
        ])
        .env("NO_DNA", "1")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("runtime-test cargo process should start");

    assert!(
        output.status.success(),
        "QuasarSVM runtime test {name} failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
}

#[test]
fn runtime_settles_successfully_for_eligible_buyer() {
    run_runtime_test("tests::settles_successfully_for_eligible_buyer");
}

#[test]
fn runtime_payment_failure_is_atomic() {
    run_runtime_test("tests::payment_failure_is_atomic");
}

#[test]
fn runtime_settlement_requires_offering_authority_signature() {
    run_runtime_test("tests::settlement_requires_offering_authority_signature");
}

#[test]
fn runtime_fee_rounding_boundary_is_half_up_to_cents() {
    run_runtime_test("tests::fee_rounding_boundary_is_half_up_to_cents");
}

#[test]
fn runtime_arithmetic_overflow_is_atomic() {
    run_runtime_test("tests::arithmetic_overflow_is_atomic");
}

#[test]
fn runtime_initialization_rejects_an_active_mint_authority() {
    run_runtime_test("tests::initialization_rejects_an_active_mint_authority");
}

#[test]
fn runtime_holder_account_stays_frozen_after_purchase_and_revocation() {
    run_runtime_test("tests::holder_account_stays_frozen_after_purchase_and_revocation");
}

#[test]
fn runtime_settlement_rejects_a_destination_that_is_not_frozen() {
    run_runtime_test("tests::settlement_rejects_a_destination_that_is_not_frozen");
}

#[test]
fn runtime_missing_revoked_and_ineligible_buyers_cannot_settle() {
    run_runtime_test("tests::missing_revoked_and_ineligible_buyers_cannot_settle");
}

#[test]
fn runtime_cap_and_initial_inventory_are_enforced() {
    run_runtime_test("tests::cap_and_initial_inventory_are_enforced");
}

#[test]
fn runtime_authority_can_close_and_reopen_offering() {
    run_runtime_test("tests::authority_can_close_and_reopen_offering");
}
