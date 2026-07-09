use anchor_lang::prelude::*;
use anchor_spl::token_interface::{thaw_account, Mint, ThawAccount, TokenAccount, TokenInterface};

use crate::error::DvpError;
use crate::state::{Eligibility, Offering};

/// Permissionless self-thaw (the Token-ACL crank). Anyone may pay to thaw a token account, but ONLY if
/// its owner has an on-chain Eligibility marked `eligible`. The mint's freeze authority is the offering
/// PDA, so the thaw CPI is signed by the program — a wallet can never thaw itself without a valid
/// platform-written attestation. Once thawed, the account transfers freely (composability preserved);
/// compliance was enforced here, not on every transfer.
#[derive(Accounts)]
pub struct Thaw<'info> {
    /// Pays the transaction; may be anyone (the owner, or a platform crank) — this is permissionless.
    #[account(mut)]
    pub cranker: Signer<'info>,

    #[account(
        seeds = [b"offering", property_mint.key().as_ref()],
        bump = offering.bump,
        has_one = property_mint,
    )]
    pub offering: Account<'info, Offering>,

    pub property_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The account to thaw. Its `owner` is what the Eligibility PDA is keyed on.
    #[account(mut, token::mint = property_mint, token::token_program = token_program)]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The attestation for `token_account.owner`. The seed binding guarantees it is THIS owner's row,
    /// and the constraint enforces it is currently cleared.
    #[account(
        seeds = [b"eligibility", property_mint.key().as_ref(), token_account.owner.as_ref()],
        bump = eligibility.bump,
        constraint = eligibility.eligible @ DvpError::NotEligible,
    )]
    pub eligibility: Account<'info, Eligibility>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Thaw>) -> Result<()> {
    // The offering PDA is the mint's freeze authority; sign the thaw CPI as that PDA.
    let mint_key = ctx.accounts.property_mint.key();
    let bump_seed = [ctx.accounts.offering.bump];
    let seeds: &[&[u8]] = &[b"offering", mint_key.as_ref(), &bump_seed];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    thaw_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        ThawAccount {
            account: ctx.accounts.token_account.to_account_info(),
            mint: ctx.accounts.property_mint.to_account_info(),
            authority: ctx.accounts.offering.to_account_info(),
        },
        signer_seeds,
    ))?;
    Ok(())
}
