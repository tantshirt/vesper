use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::DvpError;
use crate::state::{Offering, PurchaseSettled};

/// Atomic delivery-versus-payment for a primary purchase. Both token movements happen in this ONE
/// instruction, so the enclosing transaction is all-or-nothing: if the USDC leg fails (e.g. the buyer
/// is underfunded) the property leg never runs and the whole transaction reverts — the buyer cannot
/// receive tokens without paying, and the platform cannot take payment without delivering.
///
/// Price and offering cap are enforced on-chain here (not merely by whoever built the transaction),
/// which is the reason this is a program and not just two bare SPL transfers in one transaction.
#[derive(Accounts)]
pub struct SettlePurchase<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"offering", property_mint.key().as_ref()],
        bump = offering.bump,
        has_one = property_mint,
        has_one = usdc_mint,
        has_one = vault,
        has_one = treasury,
    )]
    pub offering: Account<'info, Offering>,

    // These are Boxed to keep the generated `try_accounts` stack frame under BPF's 4 KB limit —
    // several unboxed Token-2022 InterfaceAccounts on the stack overflow it.
    pub property_mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    // --- property leg: vault (PDA-owned) -> buyer ---
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = property_mint, token::authority = buyer)]
    pub buyer_property: Box<InterfaceAccount<'info, TokenAccount>>,

    // --- usdc leg: buyer -> treasury ---
    #[account(mut, token::mint = usdc_mint, token::authority = buyer)]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,

    pub property_token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<SettlePurchase>, token_amount: u64) -> Result<()> {
    // --- gates (all checked before either transfer) ---
    require!(!ctx.accounts.offering.closed, DvpError::OfferingClosed);
    require!(token_amount > 0, DvpError::ZeroAmount);

    let sold_after = ctx
        .accounts
        .offering
        .sold
        .checked_add(token_amount)
        .ok_or(DvpError::MathOverflow)?;
    require!(
        sold_after <= ctx.accounts.offering.total_offering,
        DvpError::ExceedsOffering
    );

    let usdc_amount = token_amount
        .checked_mul(ctx.accounts.offering.price_per_token)
        .ok_or(DvpError::MathOverflow)?;

    // --- leg 1: buyer pays USDC -> treasury (buyer signs) ---
    // Anchor 1.0 CpiContext::new takes the program *id* (Pubkey); the token program account itself is
    // loaded via the `usdc_token_program` Interface in the Accounts struct.
    transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        usdc_amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // --- leg 2: property token vault -> buyer (offering PDA signs) ---
    // Bind the bump to a named array so the seed slices don't dangle on BPF (temporary-lifetime trap).
    let property_mint_key = ctx.accounts.property_mint.key();
    let bump_seed = [ctx.accounts.offering.bump];
    let seeds: &[&[u8]] = &[b"offering", property_mint_key.as_ref(), &bump_seed];
    let signer_seeds: &[&[&[u8]]] = &[seeds];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.property_token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.property_mint.to_account_info(),
                to: ctx.accounts.buyer_property.to_account_info(),
                authority: ctx.accounts.offering.to_account_info(),
            },
            signer_seeds,
        ),
        token_amount,
        ctx.accounts.property_mint.decimals,
    )?;

    // --- commit: record the sale and emit the receipt event ---
    let offering = &mut ctx.accounts.offering;
    offering.sold = sold_after;

    emit!(PurchaseSettled {
        offering: offering.key(),
        buyer: ctx.accounts.buyer.key(),
        property_mint: property_mint_key,
        token_amount,
        usdc_amount,
        sold_after,
    });

    Ok(())
}
