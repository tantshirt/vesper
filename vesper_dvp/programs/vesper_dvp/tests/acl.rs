//! Token-ACL verification (Slice 6), in-process on LiteSVM.
//!
//! Proves the compliance rail end to end on a mint whose freeze authority is the offering PDA:
//!   1. a frozen token account cannot receive delivery — `settle_purchase` reverts atomically;
//!   2. `thaw` refuses without an eligibility attestation, and refuses when `eligible = false`;
//!   3. only the offering authority may `set_eligibility` / `freeze` (Unauthorized otherwise);
//!   4. once the admin attests `eligible = true`, a permissionless `thaw` unfreezes the account and
//!      the same `settle_purchase` then succeeds.
//!
//! The property mint here is classic SPL (like dvp.rs) with a freeze authority — production uses
//! Token-2022 + DefaultAccountState=Frozen so accounts start frozen on creation; the program logic
//! (freeze/thaw gated by eligibility) is identical, so `freeze` stands in for default-frozen here.

use {
    anchor_lang::{
        solana_program::{
            instruction::{AccountMeta, Instruction},
            pubkey::Pubkey,
            system_program,
        },
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::str::FromStr,
};

fn spl_token() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

const USDC_DECIMALS: u8 = 6;
const PROPERTY_DECIMALS: u8 = 0;
const PRICE_PER_TOKEN: u64 = 50_000_000;
const TOTAL_OFFERING: u64 = 100;
const RENT_LAMPORTS: u64 = 10_000_000;
const MINT_SPACE: u64 = 82;
const TOKEN_ACCOUNT_SPACE: u64 = 165;
const ACCOUNT_STATE_OFFSET: usize = 108; // SPL token Account.state byte (2 = Frozen, 1 = Initialized)

// --- hand-encoded setup instructions ------------------------------------------------------------

fn create_account_ix(payer: &Pubkey, new_acct: &Pubkey, lamports: u64, space: u64, owner: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(52);
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&space.to_le_bytes());
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: system_program::ID,
        accounts: vec![AccountMeta::new(*payer, true), AccountMeta::new(*new_acct, true)],
        data,
    }
}

// InitializeMint2 with an OPTIONAL freeze authority — the property mint needs the offering PDA as its
// freeze authority so the program can freeze/thaw.
fn init_mint2_ix(mint: &Pubkey, decimals: u8, authority: &Pubkey, freeze: Option<&Pubkey>) -> Instruction {
    let mut data = vec![20u8, decimals];
    data.extend_from_slice(authority.as_ref());
    match freeze {
        Some(f) => {
            data.push(1);
            data.extend_from_slice(f.as_ref());
        }
        None => data.push(0),
    }
    Instruction { program_id: spl_token(), accounts: vec![AccountMeta::new(*mint, false)], data }
}

fn init_account3_ix(account: &Pubkey, mint: &Pubkey, owner: &Pubkey) -> Instruction {
    let mut data = vec![18u8];
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: spl_token(),
        accounts: vec![AccountMeta::new(*account, false), AccountMeta::new_readonly(*mint, false)],
        data,
    }
}

fn mint_to_ix(mint: &Pubkey, account: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: spl_token(),
        accounts: vec![
            AccountMeta::new(*mint, false),
            AccountMeta::new(*account, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let acct = svm.get_account(account).expect("token account exists");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

fn is_frozen(svm: &LiteSVM, account: &Pubkey) -> bool {
    let acct = svm.get_account(account).expect("token account exists");
    acct.data[ACCOUNT_STATE_OFFSET] == 2
}

fn send(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction], signers: &[&Keypair]) {
    svm.expire_blockhash();
    let bh = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), signers, bh);
    svm.send_transaction(tx).expect("setup transaction should succeed");
}

struct World {
    svm: LiteSVM,
    program_id: Pubkey,
    admin: Keypair,
    buyer: Keypair,
    property_mint: Pubkey,
    usdc_mint: Pubkey,
    offering: Pubkey,
    vault: Pubkey,
    treasury: Pubkey,
    buyer_property: Pubkey,
    buyer_usdc: Pubkey,
}

impl World {
    fn eligibility_pda(&self, owner: &Pubkey) -> Pubkey {
        Pubkey::find_program_address(
            &[b"eligibility", self.property_mint.as_ref(), owner.as_ref()],
            &self.program_id,
        )
        .0
    }
}

fn build_world() -> World {
    let program_id = vesper_dvp::id();
    let mut svm = LiteSVM::new();
    let so_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/vesper_dvp.so");
    svm.add_program_from_file(program_id, so_path).unwrap();

    let admin = Keypair::new(); // offering authority + mint authority + fee payer
    let buyer = Keypair::new();
    svm.airdrop(&admin.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer.pubkey(), 1_000_000_000).unwrap();

    let usdc_mint = Keypair::new();
    let property_mint = Keypair::new();
    let buyer_usdc = Keypair::new();
    let treasury = Keypair::new();
    let buyer_property = Keypair::new();
    let vault = Keypair::new();

    let (offering, _bump) =
        Pubkey::find_program_address(&[b"offering", property_mint.pubkey().as_ref()], &program_id);
    let treasury_owner = Pubkey::new_unique();

    // Mints. The property mint's freeze authority is the offering PDA (so the program can freeze/thaw).
    send(
        &mut svm,
        &admin,
        &[
            create_account_ix(&admin.pubkey(), &usdc_mint.pubkey(), RENT_LAMPORTS, MINT_SPACE, &spl_token()),
            init_mint2_ix(&usdc_mint.pubkey(), USDC_DECIMALS, &admin.pubkey(), None),
            create_account_ix(&admin.pubkey(), &property_mint.pubkey(), RENT_LAMPORTS, MINT_SPACE, &spl_token()),
            init_mint2_ix(&property_mint.pubkey(), PROPERTY_DECIMALS, &admin.pubkey(), Some(&offering)),
        ],
        &[&admin, &usdc_mint, &property_mint],
    );

    // Token accounts.
    send(
        &mut svm,
        &admin,
        &[
            create_account_ix(&admin.pubkey(), &buyer_usdc.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&buyer_usdc.pubkey(), &usdc_mint.pubkey(), &buyer.pubkey()),
            create_account_ix(&admin.pubkey(), &treasury.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&treasury.pubkey(), &usdc_mint.pubkey(), &treasury_owner),
            create_account_ix(&admin.pubkey(), &buyer_property.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&buyer_property.pubkey(), &property_mint.pubkey(), &buyer.pubkey()),
            create_account_ix(&admin.pubkey(), &vault.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&vault.pubkey(), &property_mint.pubkey(), &offering),
        ],
        &[&admin, &buyer_usdc, &treasury, &buyer_property, &vault],
    );

    // Balances.
    send(
        &mut svm,
        &admin,
        &[
            mint_to_ix(&usdc_mint.pubkey(), &buyer_usdc.pubkey(), &admin.pubkey(), 200_000_000),
            mint_to_ix(&property_mint.pubkey(), &vault.pubkey(), &admin.pubkey(), TOTAL_OFFERING),
        ],
        &[&admin],
    );

    // Offering.
    let init_ix = Instruction {
        program_id,
        accounts: vesper_dvp::accounts::InitializeOffering {
            authority: admin.pubkey(),
            property_mint: property_mint.pubkey(),
            usdc_mint: usdc_mint.pubkey(),
            offering,
            vault: vault.pubkey(),
            treasury: treasury.pubkey(),
            property_token_program: spl_token(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: vesper_dvp::instruction::InitializeOffering {
            price_per_token: PRICE_PER_TOKEN,
            total_offering: TOTAL_OFFERING,
        }
        .data(),
    };
    send(&mut svm, &admin, &[init_ix], &[&admin]);

    World {
        svm,
        program_id,
        admin,
        buyer,
        property_mint: property_mint.pubkey(),
        usdc_mint: usdc_mint.pubkey(),
        offering,
        vault: vault.pubkey(),
        treasury: treasury.pubkey(),
        buyer_property: buyer_property.pubkey(),
        buyer_usdc: buyer_usdc.pubkey(),
    }
}

// --- instruction builders for the program under test --------------------------------------------

fn set_eligibility_ix(w: &World, owner: &Pubkey, authority: &Pubkey, eligible: bool) -> Instruction {
    Instruction {
        program_id: w.program_id,
        accounts: vesper_dvp::accounts::SetEligibility {
            authority: *authority,
            offering: w.offering,
            property_mint: w.property_mint,
            owner: *owner,
            eligibility: w.eligibility_pda(owner),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: vesper_dvp::instruction::SetEligibility { eligible }.data(),
    }
}

fn thaw_ix(w: &World, token_account: &Pubkey, owner: &Pubkey, cranker: &Pubkey) -> Instruction {
    Instruction {
        program_id: w.program_id,
        accounts: vesper_dvp::accounts::Thaw {
            cranker: *cranker,
            offering: w.offering,
            property_mint: w.property_mint,
            token_account: *token_account,
            eligibility: w.eligibility_pda(owner),
            token_program: spl_token(),
        }
        .to_account_metas(None),
        data: vesper_dvp::instruction::Thaw {}.data(),
    }
}

fn freeze_ix(w: &World, token_account: &Pubkey, authority: &Pubkey) -> Instruction {
    Instruction {
        program_id: w.program_id,
        accounts: vesper_dvp::accounts::Freeze {
            authority: *authority,
            offering: w.offering,
            property_mint: w.property_mint,
            token_account: *token_account,
            token_program: spl_token(),
        }
        .to_account_metas(None),
        data: vesper_dvp::instruction::Freeze {}.data(),
    }
}

fn settle_ix(w: &World, token_amount: u64) -> Instruction {
    Instruction {
        program_id: w.program_id,
        accounts: vesper_dvp::accounts::SettlePurchase {
            buyer: w.buyer.pubkey(),
            offering: w.offering,
            property_mint: w.property_mint,
            usdc_mint: w.usdc_mint,
            vault: w.vault,
            buyer_property: w.buyer_property,
            buyer_usdc: w.buyer_usdc,
            treasury: w.treasury,
            property_token_program: spl_token(),
            usdc_token_program: spl_token(),
        }
        .to_account_metas(None),
        data: vesper_dvp::instruction::SettlePurchase { token_amount }.data(),
    }
}

fn run(w: &mut World, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> bool {
    w.svm.expire_blockhash(); // fresh blockhash so identical (negative-path) txs don't collide by sig
    let bh = w.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), signers, bh);
    w.svm.send_transaction(tx).is_ok()
}

// Byte-roundtrip clone (Keypair isn't Clone); lets us hold owned admin/buyer keypairs while `w`
// is borrowed mutably for `run`.
fn dup(kp: &Keypair) -> Keypair {
    kp.insecure_clone()
}

#[test]
fn full_acl_lifecycle() {
    let mut w = build_world();
    let buyer_pk = w.buyer.pubkey();
    let admin = dup(&w.admin);
    let buyer = dup(&w.buyer);
    let buyer_property = w.buyer_property;

    // Admin freezes the buyer's account (stands in for DefaultAccountState=Frozen).
    let ix = freeze_ix(&w, &buyer_property, &admin.pubkey());
    assert!(run(&mut w, ix, &admin, &[&admin]));
    assert!(is_frozen(&w.svm, &buyer_property), "account is frozen");

    // 1. settle to a frozen account must fail atomically — nothing moves.
    let ix = settle_ix(&w, 2);
    assert!(!run(&mut w, ix, &buyer, &[&buyer]), "settle must fail into a frozen account");
    assert_eq!(token_balance(&w.svm, &buyer_property), 0);
    assert_eq!(token_balance(&w.svm, &w.vault), TOTAL_OFFERING);
    assert_eq!(token_balance(&w.svm, &w.treasury), 0);

    // 2. thaw without any eligibility attestation must fail (the eligibility PDA doesn't exist).
    let ix = thaw_ix(&w, &buyer_property, &buyer_pk, &buyer.pubkey());
    assert!(!run(&mut w, ix, &buyer, &[&buyer]), "thaw must fail with no eligibility");
    assert!(is_frozen(&w.svm, &buyer_property), "still frozen");

    // 3. only the offering authority may attest — a stranger is rejected.
    let stranger = Keypair::new();
    w.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = set_eligibility_ix(&w, &buyer_pk, &stranger.pubkey(), true);
    assert!(!run(&mut w, ix, &stranger, &[&stranger]), "non-authority cannot set eligibility");

    // 4. admin attests INELIGIBLE → thaw still refuses.
    let ix = set_eligibility_ix(&w, &buyer_pk, &admin.pubkey(), false);
    assert!(run(&mut w, ix, &admin, &[&admin]));
    let ix = thaw_ix(&w, &buyer_property, &buyer_pk, &buyer.pubkey());
    assert!(!run(&mut w, ix, &buyer, &[&buyer]), "thaw must fail when eligible = false");
    assert!(is_frozen(&w.svm, &buyer_property), "still frozen");

    // 5. admin attests ELIGIBLE → permissionless thaw succeeds (cranked here by the buyer).
    let ix = set_eligibility_ix(&w, &buyer_pk, &admin.pubkey(), true);
    assert!(run(&mut w, ix, &admin, &[&admin]));
    let ix = thaw_ix(&w, &buyer_property, &buyer_pk, &buyer.pubkey());
    assert!(run(&mut w, ix, &buyer, &[&buyer]));
    assert!(!is_frozen(&w.svm, &buyer_property), "account is now thawed");

    // 6. settle now succeeds — the compliance gate has opened.
    let ix = settle_ix(&w, 2);
    assert!(run(&mut w, ix, &buyer, &[&buyer]), "settle succeeds after thaw");
    assert_eq!(token_balance(&w.svm, &buyer_property), 2);
    assert_eq!(token_balance(&w.svm, &w.vault), TOTAL_OFFERING - 2);
    assert_eq!(token_balance(&w.svm, &w.treasury), 2 * PRICE_PER_TOKEN);
}
