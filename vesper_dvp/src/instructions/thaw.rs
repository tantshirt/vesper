use {
    crate::{
        errors::DvpError,
        state::{Eligibility, Offering},
    },
    quasar_lang::prelude::*,
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[allow(dead_code)]
pub struct Thaw {
    #[account(mut)]
    pub cranker: Signer,
    #[account(has_one(property_mint), address = Offering::seeds(property_mint.address()))]
    pub offering: Account<Offering>,
    pub property_mint: InterfaceAccount<Mint>,
    #[account(mut)]
    pub token_account: InterfaceAccount<Token>,
    /// CHECK: Read-only alias role. `owner` may equal `offering` when thawing the offering-owned
    /// vault; the handler verifies the token account owner and Eligibility PDA binding.
    #[account(dup)]
    pub owner: UncheckedAccount,
    #[account(
        address = Eligibility::seeds(property_mint.address(), owner.address()),
        constraints(eligibility.eligible.into()) @ DvpError::NotEligible
    )]
    pub eligibility: Account<Eligibility>,
    pub token_program: Interface<TokenInterface>,
}

impl Thaw {
    #[inline(always)]
    pub fn thaw(&self) -> Result<(), ProgramError> {
        Err(DvpError::PublicThawDisabled.into())
    }
}
