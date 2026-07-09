use anchor_lang::prelude::*;
use anchor_spl::token_interface::{freeze_account, FreezeAccount, Mint, TokenAccount, TokenInterface};

use crate::error::DvpError;
use crate::state::Offering;

/// Admin-only freeze — the compliance counterpart to `thaw`. The platform (offering.authority) can
/// re-freeze a wallet's token account on a compliance event (revoked KYC, sanctions hit, expiry). It
/// is also how frozen state is reached in tests without hand-encoding the Token-2022
/// DefaultAccountState extension (which, in production, freezes new accounts on creation instead).
#[derive(Accounts)]
pub struct Freeze<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"offering", property_mint.key().as_ref()],
        bump = offering.bump,
        has_one = property_mint,
        has_one = authority @ DvpError::Unauthorized,
    )]
    pub offering: Account<'info, Offering>,

    pub property_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = property_mint, token::token_program = token_program)]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<Freeze>) -> Result<()> {
    // Sign the freeze CPI as the offering PDA (the mint's freeze authority).
    let mint_key = ctx.accounts.property_mint.key();
    let bump_seed = [ctx.accounts.offering.bump];
    let seeds: &[&[u8]] = &[b"offering", mint_key.as_ref(), &bump_seed];
    let signer_seeds: &[&[&[u8]]] = &[seeds];

    freeze_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        FreezeAccount {
            account: ctx.accounts.token_account.to_account_info(),
            mint: ctx.accounts.property_mint.to_account_info(),
            authority: ctx.accounts.offering.to_account_info(),
        },
        signer_seeds,
    ))?;
    Ok(())
}
