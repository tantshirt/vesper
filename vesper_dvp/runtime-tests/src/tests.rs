use {
    quasar_svm::{
        token::{
            create_keyed_mint_account, create_keyed_mint_account_with_program,
            create_keyed_system_account, create_keyed_token_account,
            create_keyed_token_account_with_program, Mint, TokenAccount,
        },
        Account, AccountMeta, Instruction, Pubkey, QuasarSvm, SPL_TOKEN_2022_PROGRAM_ID,
        SPL_TOKEN_PROGRAM_ID,
    },
    spl_token_interface::state::AccountState,
    std::{fs, path::Path, str::FromStr},
};

const AUTHORITY: Pubkey = Pubkey::new_from_array([1; 32]);
const ATTACKER: Pubkey = Pubkey::new_from_array([2; 32]);
const BUYER: Pubkey = Pubkey::new_from_array([3; 32]);
const PROPERTY_MINT: Pubkey = Pubkey::new_from_array([4; 32]);
const USDC_MINT: Pubkey = Pubkey::new_from_array([5; 32]);
const VAULT: Pubkey = Pubkey::new_from_array([6; 32]);
const TREASURY: Pubkey = Pubkey::new_from_array([7; 32]);
const BUYER_PROPERTY: Pubkey = Pubkey::new_from_array([8; 32]);
const BUYER_USDC: Pubkey = Pubkey::new_from_array([9; 32]);
const RECIPIENT_PROPERTY: Pubkey = Pubkey::new_from_array([10; 32]);

const PRICE_PER_TOKEN: u64 = 50_000_000;
const TOTAL_OFFERING: u64 = 100;
const BUYER_USDC_BALANCE: u64 = 200_000_000;

fn program_id() -> Pubkey {
    Pubkey::from_str("CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2").unwrap()
}

fn offering_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"offering", PROPERTY_MINT.as_ref()], &program_id())
}

fn eligibility_address(owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"eligibility", PROPERTY_MINT.as_ref(), owner.as_ref()],
        &program_id(),
    )
}

fn signer(address: Pubkey) -> Account {
    create_keyed_system_account(&address, 1_000_000_000)
}

fn empty(address: Pubkey) -> Account {
    Account {
        address,
        lamports: 0,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

fn property_mint(mint_authority: Option<Pubkey>) -> Account {
    let (offering, _) = offering_address();
    let mint = Mint {
        mint_authority: mint_authority.into(),
        supply: TOTAL_OFFERING,
        decimals: 0,
        is_initialized: true,
        freeze_authority: Some(offering).into(),
    };
    let mut account =
        create_keyed_mint_account_with_program(&PROPERTY_MINT, &mint, &SPL_TOKEN_2022_PROGRAM_ID);

    // Token-2022 extended mint layout: padded base, Mint account type, then
    // DefaultAccountState(type=6, len=1, state=Frozen=2).
    account.data.resize(171, 0);
    account.data[165] = 1;
    account.data[166..168].copy_from_slice(&6u16.to_le_bytes());
    account.data[168..170].copy_from_slice(&1u16.to_le_bytes());
    account.data[170] = 2;
    account
}

fn usdc_mint() -> Account {
    create_keyed_mint_account(
        &USDC_MINT,
        &Mint {
            mint_authority: Some(AUTHORITY).into(),
            supply: BUYER_USDC_BALANCE,
            decimals: 6,
            is_initialized: true,
            freeze_authority: None.into(),
        },
    )
}

fn token_account(
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
    token_program: Pubkey,
) -> Account {
    let state = TokenAccount {
        mint,
        owner,
        amount,
        state: AccountState::Initialized,
        ..TokenAccount::default()
    };
    if token_program == SPL_TOKEN_2022_PROGRAM_ID {
        create_keyed_token_account_with_program(&address, &state, &token_program)
    } else {
        create_keyed_token_account(&address, &state)
    }
}

fn frozen_token_account(
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
    token_program: Pubkey,
) -> Account {
    let mut account = token_account(address, mint, owner, amount, token_program);
    account.data[108] = AccountState::Frozen as u8;
    account
}

fn eligibility_account(owner: Pubkey, eligible: bool) -> Account {
    let (address, bump) = eligibility_address(&owner);
    let mut data = Vec::with_capacity(67);
    data.push(2);
    data.extend_from_slice(PROPERTY_MINT.as_ref());
    data.extend_from_slice(owner.as_ref());
    data.push(u8::from(eligible));
    data.push(bump);
    Account {
        address,
        lamports: 2_000_000,
        data,
        owner: program_id(),
        executable: false,
    }
}

fn setup_svm() -> QuasarSvm {
    let elf_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/deploy/vesper_dvp.so");
    let elf = fs::read(elf_path).expect("run `NO_DNA=1 quasar build` before runtime tests");
    QuasarSvm::new().with_program(&program_id(), &elf)
}

fn initialize_instruction(authority: Pubkey, total_offering: u64) -> Instruction {
    let (offering, _) = offering_address();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(PROPERTY_MINT, false),
            AccountMeta::new_readonly(USDC_MINT, false),
            AccountMeta::new(offering, false),
            AccountMeta::new_readonly(VAULT, false),
            AccountMeta::new_readonly(TREASURY, false),
            AccountMeta::new_readonly(SPL_TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data: [
            vec![0],
            PRICE_PER_TOKEN.to_le_bytes().to_vec(),
            total_offering.to_le_bytes().to_vec(),
        ]
        .concat(),
    }
}

fn initialize_accounts(authority: Pubkey, vault_inventory: u64) -> Vec<Account> {
    let (offering, _) = offering_address();
    vec![
        signer(authority),
        property_mint(None),
        usdc_mint(),
        empty(offering),
        token_account(
            VAULT,
            PROPERTY_MINT,
            offering,
            vault_inventory,
            SPL_TOKEN_2022_PROGRAM_ID,
        ),
        token_account(TREASURY, USDC_MINT, AUTHORITY, 0, SPL_TOKEN_PROGRAM_ID),
    ]
}

fn initialize(svm: &mut QuasarSvm, vault_inventory: u64) {
    svm.process_instruction(
        &initialize_instruction(AUTHORITY, TOTAL_OFFERING),
        &initialize_accounts(AUTHORITY, vault_inventory),
    )
    .expect("offering initialization should succeed");
}

fn settle_instruction_with_authority(
    token_amount: u64,
    authority: Pubkey,
    authority_is_signer: bool,
) -> Instruction {
    let (offering, _) = offering_address();
    let (eligibility, _) = eligibility_address(&BUYER);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(BUYER, true),
            AccountMeta::new(offering, false),
            AccountMeta::new_readonly(PROPERTY_MINT, false),
            AccountMeta::new_readonly(USDC_MINT, false),
            AccountMeta::new(VAULT, false),
            AccountMeta::new(BUYER_PROPERTY, false),
            AccountMeta::new(BUYER_USDC, false),
            AccountMeta::new(TREASURY, false),
            AccountMeta::new_readonly(eligibility, false),
            AccountMeta::new_readonly(SPL_TOKEN_2022_PROGRAM_ID, false),
            AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(authority, authority_is_signer),
        ],
        data: [vec![1], token_amount.to_le_bytes().to_vec()].concat(),
    }
}

fn settle_instruction(token_amount: u64) -> Instruction {
    settle_instruction_with_authority(token_amount, AUTHORITY, true)
}

fn settlement_accounts(eligible: bool, buyer_usdc: u64) -> Vec<Account> {
    vec![
        signer(BUYER),
        frozen_token_account(
            BUYER_PROPERTY,
            PROPERTY_MINT,
            BUYER,
            0,
            SPL_TOKEN_2022_PROGRAM_ID,
        ),
        token_account(
            BUYER_USDC,
            USDC_MINT,
            BUYER,
            buyer_usdc,
            SPL_TOKEN_PROGRAM_ID,
        ),
        eligibility_account(BUYER, eligible),
    ]
}

fn set_closed_instruction(authority: Pubkey, closed: bool) -> Instruction {
    let (offering, _) = offering_address();
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(offering, false),
            AccountMeta::new_readonly(PROPERTY_MINT, false),
        ],
        data: vec![5, u8::from(closed)],
    }
}

fn token_balance(svm: &QuasarSvm, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).expect("token account exists");
    u64::from_le_bytes(account.data[64..72].try_into().unwrap())
}

fn token_state(svm: &QuasarSvm, address: &Pubkey) -> u8 {
    svm.get_account(address).expect("token account exists").data[108]
}

fn set_eligibility_instruction(eligible: bool) -> Instruction {
    let (offering, _) = offering_address();
    let (eligibility, _) = eligibility_address(&BUYER);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(AUTHORITY, true),
            AccountMeta::new_readonly(offering, false),
            AccountMeta::new_readonly(PROPERTY_MINT, false),
            AccountMeta::new_readonly(BUYER, false),
            AccountMeta::new(eligibility, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data: vec![2, u8::from(eligible)],
    }
}

fn public_thaw_instruction() -> Instruction {
    let (offering, _) = offering_address();
    let (eligibility, _) = eligibility_address(&BUYER);
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(BUYER, true),
            AccountMeta::new_readonly(offering, false),
            AccountMeta::new_readonly(PROPERTY_MINT, false),
            AccountMeta::new(BUYER_PROPERTY, false),
            AccountMeta::new_readonly(BUYER, false),
            AccountMeta::new_readonly(eligibility, false),
            AccountMeta::new_readonly(SPL_TOKEN_2022_PROGRAM_ID, false),
        ],
        data: vec![3],
    }
}

fn holder_transfer_instruction(amount: u64) -> Instruction {
    Instruction {
        program_id: SPL_TOKEN_2022_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(BUYER_PROPERTY, false),
            AccountMeta::new(RECIPIENT_PROPERTY, false),
            AccountMeta::new_readonly(BUYER, true),
        ],
        data: [vec![3], amount.to_le_bytes().to_vec()].concat(),
    }
}

fn offering_sold(svm: &QuasarSvm) -> u64 {
    let account = svm
        .get_account(&offering_address().0)
        .expect("offering exists");
    u64::from_le_bytes(account.data[177..185].try_into().unwrap())
}

fn set_offering_price(svm: &mut QuasarSvm, price_per_token: u64) {
    let offering = offering_address().0;
    let mut account = svm.get_account(&offering).expect("offering exists");
    account.data[161..169].copy_from_slice(&price_per_token.to_le_bytes());
    svm.set_account(account);
}

#[test]
fn settles_successfully_for_eligible_buyer() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    svm.process_instruction(
        &settle_instruction(2),
        &settlement_accounts(true, BUYER_USDC_BALANCE),
    )
    .expect("eligible settlement should succeed");

    assert_eq!(token_balance(&svm, &BUYER_PROPERTY), 2);
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING - 2);
    assert_eq!(token_balance(&svm, &TREASURY), 100_900_000);
    assert_eq!(token_balance(&svm, &BUYER_USDC), 99_100_000);
    assert_eq!(offering_sold(&svm), 2);
    assert_eq!(token_state(&svm, &BUYER_PROPERTY), AccountState::Frozen as u8);
}

#[test]
fn holder_account_stays_frozen_after_purchase_and_revocation() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    svm.process_instruction(
        &settle_instruction(2),
        &settlement_accounts(true, BUYER_USDC_BALANCE),
    )
    .expect("eligible settlement should succeed");
    assert_eq!(token_state(&svm, &BUYER_PROPERTY), AccountState::Frozen as u8);

    assert!(
        svm.process_instruction(&public_thaw_instruction(), &[]).is_err(),
        "standalone thaw must remain disabled"
    );
    assert_eq!(token_state(&svm, &BUYER_PROPERTY), AccountState::Frozen as u8);

    svm.process_instruction(&set_eligibility_instruction(false), &[])
        .expect("authority should revoke eligibility");
    svm.set_account(frozen_token_account(
        RECIPIENT_PROPERTY,
        PROPERTY_MINT,
        ATTACKER,
        0,
        SPL_TOKEN_2022_PROGRAM_ID,
    ));
    assert!(
        svm.process_instruction(&holder_transfer_instruction(1), &[]).is_err(),
        "holder transfer from frozen custody must fail after revocation"
    );
    assert_eq!(token_balance(&svm, &BUYER_PROPERTY), 2);
    assert_eq!(token_balance(&svm, &RECIPIENT_PROPERTY), 0);
}

#[test]
fn settlement_rejects_a_destination_that_is_not_frozen() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    let mut accounts = settlement_accounts(true, BUYER_USDC_BALANCE);
    accounts[1].data[108] = AccountState::Initialized as u8;
    assert!(
        svm.process_instruction(&settle_instruction(1), &accounts)
            .is_err(),
        "settlement must not accept a destination left transferable"
    );
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING);
    assert_eq!(token_balance(&svm, &TREASURY), 0);
    assert_eq!(offering_sold(&svm), 0);
}

#[test]
fn settlement_requires_offering_authority_signature() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    for account in settlement_accounts(true, BUYER_USDC_BALANCE) {
        svm.set_account(account);
    }

    let buyer_only =
        svm.process_instruction(&settle_instruction_with_authority(1, AUTHORITY, false), &[]);
    assert!(buyer_only.is_err(), "buyer-only settlement must fail");

    let wrong_authority = svm.process_instruction(
        &settle_instruction_with_authority(1, ATTACKER, true),
        &[signer(ATTACKER)],
    );
    assert!(wrong_authority.is_err(), "wrong authority must fail");
    assert_eq!(token_balance(&svm, &BUYER_PROPERTY), 0);
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING);
    assert_eq!(token_balance(&svm, &TREASURY), 0);
    assert_eq!(token_balance(&svm, &BUYER_USDC), BUYER_USDC_BALANCE);

    svm.process_instruction(&settle_instruction(1), &[])
        .expect("buyer plus offering authority should settle");
}

#[test]
fn fee_rounding_boundary_is_half_up_to_cents() {
    let mut below = setup_svm();
    initialize(&mut below, TOTAL_OFFERING);
    set_offering_price(&mut below, 555_555);
    below
        .process_instruction(
            &settle_instruction(1),
            &settlement_accounts(true, 1_000_000),
        )
        .expect("below-boundary settlement should succeed");
    assert_eq!(token_balance(&below, &TREASURY), 555_555);

    let mut above = setup_svm();
    initialize(&mut above, TOTAL_OFFERING);
    set_offering_price(&mut above, 555_556);
    above
        .process_instruction(
            &settle_instruction(1),
            &settlement_accounts(true, 1_000_000),
        )
        .expect("above-boundary settlement should succeed");
    assert_eq!(token_balance(&above, &TREASURY), 565_556);
}

#[test]
fn arithmetic_overflow_is_atomic() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    set_offering_price(&mut svm, u64::MAX);
    for account in settlement_accounts(true, u64::MAX) {
        svm.set_account(account);
    }

    let result = svm.process_instruction(&settle_instruction(2), &[]);
    assert!(result.is_err(), "overflowing settlement must fail");
    assert_eq!(token_balance(&svm, &BUYER_PROPERTY), 0);
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING);
    assert_eq!(token_balance(&svm, &TREASURY), 0);
    assert_eq!(token_balance(&svm, &BUYER_USDC), u64::MAX);
    assert_eq!(offering_sold(&svm), 0);
}

#[test]
fn payment_failure_is_atomic() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    for account in settlement_accounts(true, 10_000_000) {
        svm.set_account(account);
    }
    let result = svm.process_instruction(&settle_instruction(2), &[]);
    assert!(result.is_err(), "underfunded settlement must fail");

    assert_eq!(token_balance(&svm, &BUYER_PROPERTY), 0);
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING);
    assert_eq!(token_balance(&svm, &TREASURY), 0);
    assert_eq!(token_balance(&svm, &BUYER_USDC), 10_000_000);
    assert_eq!(offering_sold(&svm), 0);
}

#[test]
fn initialization_rejects_an_active_mint_authority() {
    let mut svm = setup_svm();
    let mut accounts = initialize_accounts(AUTHORITY, TOTAL_OFFERING);
    accounts[1] = property_mint(Some(AUTHORITY));
    let result = svm.process_instruction(
        &initialize_instruction(AUTHORITY, TOTAL_OFFERING),
        &accounts,
    );
    assert!(
        result.is_err(),
        "property mint authority must be revoked before initialization"
    );
    assert!(svm.get_account(&offering_address().0).is_none());
}

#[test]
fn missing_revoked_and_ineligible_buyers_cannot_settle() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);

    let missing = svm.process_instruction(
        &settle_instruction(1),
        &settlement_accounts(true, BUYER_USDC_BALANCE)[..3],
    );
    assert!(missing.is_err(), "missing Eligibility PDA must fail");

    let revoked = svm.process_instruction(
        &settle_instruction(1),
        &settlement_accounts(false, BUYER_USDC_BALANCE),
    );
    assert!(revoked.is_err(), "eligible=false must fail");
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING);
    assert_eq!(token_balance(&svm, &TREASURY), 0);
}

#[test]
fn cap_and_initial_inventory_are_enforced() {
    let mut understocked = setup_svm();
    let init = understocked.process_instruction(
        &initialize_instruction(AUTHORITY, TOTAL_OFFERING),
        &initialize_accounts(AUTHORITY, TOTAL_OFFERING - 1),
    );
    assert!(init.is_err(), "understocked vault must fail initialization");

    let mut excess_supply = setup_svm();
    let mut excess_supply_accounts = initialize_accounts(AUTHORITY, TOTAL_OFFERING);
    excess_supply_accounts[1].data[36..44]
        .copy_from_slice(&(TOTAL_OFFERING + 1).to_le_bytes());
    let init = excess_supply.process_instruction(
        &initialize_instruction(AUTHORITY, TOTAL_OFFERING),
        &excess_supply_accounts,
    );
    assert!(
        init.is_err(),
        "supply outside the offering vault must fail initialization"
    );

    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);
    let settle = svm.process_instruction(
        &settle_instruction(TOTAL_OFFERING + 1),
        &settlement_accounts(true, u64::MAX),
    );
    assert!(settle.is_err(), "purchase above offering cap must fail");
    assert_eq!(token_balance(&svm, &VAULT), TOTAL_OFFERING);
    assert_eq!(offering_sold(&svm), 0);
}

#[test]
fn authority_can_close_and_reopen_offering() {
    let mut svm = setup_svm();
    initialize(&mut svm, TOTAL_OFFERING);

    let unauthorized =
        svm.process_instruction(&set_closed_instruction(ATTACKER, true), &[signer(ATTACKER)]);
    assert!(unauthorized.is_err(), "non-authority close must fail");

    svm.process_instruction(
        &set_closed_instruction(AUTHORITY, true),
        &[signer(AUTHORITY)],
    )
    .expect("authority close should succeed");
    let closed = svm.process_instruction(
        &settle_instruction(1),
        &settlement_accounts(true, BUYER_USDC_BALANCE),
    );
    assert!(closed.is_err(), "closed offering must reject settlement");

    svm.process_instruction(
        &set_closed_instruction(AUTHORITY, false),
        &[signer(AUTHORITY)],
    )
    .expect("authority reopen should succeed");
    svm.process_instruction(
        &settle_instruction(1),
        &settlement_accounts(true, BUYER_USDC_BALANCE),
    )
    .expect("reopened offering should settle");
    assert_eq!(offering_sold(&svm), 1);
}
