//! Slice-1 verification for the atomic DvP program, run entirely in-process on LiteSVM (no validator).
//!
//! SPL setup instructions (System CreateAccount, SPL Token InitializeMint2 / InitializeAccount3 /
//! MintTo) are hand-encoded from their stable on-chain layouts, so the test pulls in NO external SPL
//! client crate and cannot hit a Solana dependency-version conflict. The program itself is driven via
//! Anchor's generated `vesper_dvp::instruction` / `vesper_dvp::accounts` structs.
//!
//! Two facts are proven:
//!   1. happy path — buyer pays USDC and receives the property token; treasury + balances reconcile.
//!   2. ATOMICITY — an underfunded buyer's `settle_purchase` reverts and NEITHER leg moves (no token
//!      delivered, no USDC taken). This is the whole point of DvP.

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

// Classic SPL Token program id (LiteSVM loads this program by default).
fn spl_token() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

const USDC_DECIMALS: u8 = 6;
const PROPERTY_DECIMALS: u8 = 0;
const PRICE_PER_TOKEN: u64 = 50_000_000; // $50 in USDC base units per 1 property token
const TOTAL_OFFERING: u64 = 100;
const RENT_LAMPORTS: u64 = 10_000_000; // comfortably rent-exempt for a mint/token account
const MINT_SPACE: u64 = 82;
const TOKEN_ACCOUNT_SPACE: u64 = 165;

// --- hand-encoded setup instructions ------------------------------------------------------------

fn create_account_ix(payer: &Pubkey, new_acct: &Pubkey, lamports: u64, space: u64, owner: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(52);
    data.extend_from_slice(&0u32.to_le_bytes()); // System: CreateAccount
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&space.to_le_bytes());
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: system_program::ID,
        accounts: vec![AccountMeta::new(*payer, true), AccountMeta::new(*new_acct, true)],
        data,
    }
}

fn init_mint2_ix(mint: &Pubkey, decimals: u8, authority: &Pubkey) -> Instruction {
    let mut data = vec![20u8, decimals]; // SPL Token: InitializeMint2
    data.extend_from_slice(authority.as_ref());
    data.push(0); // COption::None freeze authority
    Instruction { program_id: spl_token(), accounts: vec![AccountMeta::new(*mint, false)], data }
}

fn init_account3_ix(account: &Pubkey, mint: &Pubkey, owner: &Pubkey) -> Instruction {
    let mut data = vec![18u8]; // SPL Token: InitializeAccount3
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: spl_token(),
        accounts: vec![AccountMeta::new(*account, false), AccountMeta::new_readonly(*mint, false)],
        data,
    }
}

fn mint_to_ix(mint: &Pubkey, account: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![7u8]; // SPL Token: MintTo
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

fn send(svm: &mut LiteSVM, payer: &Keypair, ixs: &[Instruction], signers: &[&Keypair]) {
    let bh = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), signers, bh);
    svm.send_transaction(tx).expect("setup transaction should succeed");
}

// A funded world: mints, accounts, and a live offering. `buyer_usdc_funding` lets a test starve the
// buyer to exercise atomicity.
struct World {
    svm: LiteSVM,
    program_id: Pubkey,
    buyer: Keypair,
    property_mint: Pubkey,
    usdc_mint: Pubkey,
    offering: Pubkey,
    vault: Pubkey,
    treasury: Pubkey,
    buyer_property: Pubkey,
    buyer_usdc: Pubkey,
}

fn build_world(buyer_usdc_funding: u64) -> World {
    let program_id = vesper_dvp::id();
    let mut svm = LiteSVM::new();
    // Load the freshly-built .so at RUNTIME (not include_bytes!, which would bake in a stale program
    // whenever the test source is unchanged but the program was rebuilt).
    let so_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/vesper_dvp.so");
    svm.add_program_from_file(program_id, so_path).unwrap();

    let payer = Keypair::new(); // platform admin + mint authority + fee payer
    let buyer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 5_000_000_000).unwrap();
    svm.airdrop(&buyer.pubkey(), 1_000_000_000).unwrap(); // buyer pays the settle tx fee

    let usdc_mint = Keypair::new();
    let property_mint = Keypair::new();
    let buyer_usdc = Keypair::new();
    let treasury = Keypair::new();
    let buyer_property = Keypair::new();
    let vault = Keypair::new();

    let (offering, _bump) =
        Pubkey::find_program_address(&[b"offering", property_mint.pubkey().as_ref()], &program_id);
    let treasury_owner = Pubkey::new_unique(); // just needs to be *some* owner

    // 1. create + init the two mints
    send(
        &mut svm,
        &payer,
        &[
            create_account_ix(&payer.pubkey(), &usdc_mint.pubkey(), RENT_LAMPORTS, MINT_SPACE, &spl_token()),
            init_mint2_ix(&usdc_mint.pubkey(), USDC_DECIMALS, &payer.pubkey()),
            create_account_ix(&payer.pubkey(), &property_mint.pubkey(), RENT_LAMPORTS, MINT_SPACE, &spl_token()),
            init_mint2_ix(&property_mint.pubkey(), PROPERTY_DECIMALS, &payer.pubkey()),
        ],
        &[&payer, &usdc_mint, &property_mint],
    );

    // 2. create + init the four token accounts (vault is owned by the offering PDA)
    send(
        &mut svm,
        &payer,
        &[
            create_account_ix(&payer.pubkey(), &buyer_usdc.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&buyer_usdc.pubkey(), &usdc_mint.pubkey(), &buyer.pubkey()),
            create_account_ix(&payer.pubkey(), &treasury.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&treasury.pubkey(), &usdc_mint.pubkey(), &treasury_owner),
            create_account_ix(&payer.pubkey(), &buyer_property.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&buyer_property.pubkey(), &property_mint.pubkey(), &buyer.pubkey()),
            create_account_ix(&payer.pubkey(), &vault.pubkey(), RENT_LAMPORTS, TOKEN_ACCOUNT_SPACE, &spl_token()),
            init_account3_ix(&vault.pubkey(), &property_mint.pubkey(), &offering),
        ],
        &[&payer, &buyer_usdc, &treasury, &buyer_property, &vault],
    );

    // 3. mint the buyer's USDC and pre-mint the property tokens into the vault
    send(
        &mut svm,
        &payer,
        &[
            mint_to_ix(&usdc_mint.pubkey(), &buyer_usdc.pubkey(), &payer.pubkey(), buyer_usdc_funding),
            mint_to_ix(&property_mint.pubkey(), &vault.pubkey(), &payer.pubkey(), TOTAL_OFFERING),
        ],
        &[&payer],
    );

    // 4. initialize the offering
    let init_ix = Instruction {
        program_id,
        accounts: vesper_dvp::accounts::InitializeOffering {
            authority: payer.pubkey(),
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
    send(&mut svm, &payer, &[init_ix], &[&payer]);

    World {
        svm,
        program_id,
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

#[test]
fn settles_atomically_on_success() {
    // Buyer funded with enough USDC for 2 tokens ($100) and some slack.
    let mut w = build_world(200_000_000);
    let ix = settle_ix(&w, 2);
    let bh = w.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&w.buyer.pubkey()), &[&w.buyer], bh);

    let res = w.svm.send_transaction(tx);
    assert!(res.is_ok(), "settle_purchase should succeed: {res:?}");

    // Both legs moved, consistently.
    assert_eq!(token_balance(&w.svm, &w.buyer_property), 2, "buyer received 2 property tokens");
    assert_eq!(token_balance(&w.svm, &w.vault), TOTAL_OFFERING - 2, "vault decreased by 2");
    assert_eq!(token_balance(&w.svm, &w.treasury), 2 * PRICE_PER_TOKEN, "treasury got the USDC");
    assert_eq!(token_balance(&w.svm, &w.buyer_usdc), 200_000_000 - 2 * PRICE_PER_TOKEN, "buyer debited");
}

#[test]
fn underfunded_buyer_moves_nothing() {
    // Buyer funded with only $10 — far short of the $100 for 2 tokens.
    let mut w = build_world(10_000_000);
    let ix = settle_ix(&w, 2);
    let bh = w.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&w.buyer.pubkey()), &[&w.buyer], bh);

    let res = w.svm.send_transaction(tx);
    assert!(res.is_err(), "settle_purchase must fail when the USDC leg cannot pay");

    // ATOMICITY: neither leg moved. No token delivered, no USDC taken.
    assert_eq!(token_balance(&w.svm, &w.buyer_property), 0, "no property token delivered");
    assert_eq!(token_balance(&w.svm, &w.vault), TOTAL_OFFERING, "vault untouched");
    assert_eq!(token_balance(&w.svm, &w.treasury), 0, "treasury untouched");
    assert_eq!(token_balance(&w.svm, &w.buyer_usdc), 10_000_000, "buyer's USDC untouched");
}
