use {
    crate::{
        errors::DvpError,
        state::{Eligibility, Offering},
        token_acl_cpi,
    },
    quasar_lang::{cpi::Seed, prelude::*},
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
        require_keys_eq!(
            *self.token_account.mint(),
            *self.property_mint.address(),
            DvpError::InvalidTokenAccount
        );
        require_keys_eq!(
            *self.token_account.owner(),
            *self.owner.address(),
            DvpError::InvalidTokenAccount
        );

        let bump = [self.offering.bump];
        let seeds = [
            Seed::from(b"offering" as &[u8]),
            Seed::from(self.property_mint.address().as_ref()),
            Seed::from(bump.as_ref()),
        ];

        token_acl_cpi::thaw_account(
            &self.token_program,
            &self.token_account,
            &self.property_mint,
            &self.offering,
        )
        .invoke_signed(&seeds)
    }
}
