use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::state::Offering;

/// Create the `Offering` PDA and record its immutable config. The vault (property tokens) and the
/// treasury (USDC) are token accounts the admin creates beforehand; the constraints below bind them
/// to this offering so `settle_purchase` cannot be pointed at a different vault/treasury later.
///
/// The vault MUST already be owned by this offering PDA (the client derives the PDA address to create
/// the vault ATA), and pre-minted with the property tokens being offered. Nothing here mints — the
/// program only ever *moves* tokens that already exist, which keeps supply fixed and auditable.
#[derive(Accounts)]
pub struct InitializeOffering<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub property_mint: InterfaceAccount<'info, Mint>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + Offering::INIT_SPACE,
        seeds = [b"offering", property_mint.key().as_ref()],
        bump
    )]
    pub offering: Account<'info, Offering>,

    /// Delivery source: a property-token account owned by the offering PDA.
    #[account(
        token::mint = property_mint,
        token::authority = offering,
        token::token_program = property_token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Payment destination: any USDC token account (typically the platform treasury).
    #[account(token::mint = usdc_mint)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,

    pub property_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeOffering>,
    price_per_token: u64,
    total_offering: u64,
) -> Result<()> {
    let offering = &mut ctx.accounts.offering;
    offering.authority = ctx.accounts.authority.key();
    offering.property_mint = ctx.accounts.property_mint.key();
    offering.usdc_mint = ctx.accounts.usdc_mint.key();
    offering.treasury = ctx.accounts.treasury.key();
    offering.vault = ctx.accounts.vault.key();
    offering.price_per_token = price_per_token;
    offering.total_offering = total_offering;
    offering.sold = 0;
    offering.bump = ctx.bumps.offering;
    offering.closed = false;
    Ok(())
}
