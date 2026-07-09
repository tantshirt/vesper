use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::DvpError;
use crate::state::{Eligibility, Offering};

/// Admin-only bridge from Convex's entitlement authority to the chain. When Convex confirms a wallet's
/// KYC / suitability for a property, the platform (offering.authority) calls this to write the on-chain
/// Eligibility attestation. `init_if_needed` lets the same call both create and later flip a wallet's
/// eligibility (e.g. revoke on a compliance event by setting `eligible = false`).
#[derive(Accounts)]
pub struct SetEligibility<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"offering", property_mint.key().as_ref()],
        bump = offering.bump,
        has_one = property_mint,
        has_one = authority @ DvpError::Unauthorized,
    )]
    pub offering: Account<'info, Offering>,

    pub property_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: the investor wallet the eligibility is scoped to — used only as a PDA seed, never signs.
    pub owner: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Eligibility::INIT_SPACE,
        seeds = [b"eligibility", property_mint.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub eligibility: Account<'info, Eligibility>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<SetEligibility>, eligible: bool) -> Result<()> {
    let eligibility = &mut ctx.accounts.eligibility;
    eligibility.property_mint = ctx.accounts.property_mint.key();
    eligibility.owner = ctx.accounts.owner.key();
    eligibility.eligible = eligible;
    eligibility.bump = ctx.bumps.eligibility;
    Ok(())
}
