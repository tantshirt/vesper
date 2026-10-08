use {
    crate::{errors::DvpError, state::Offering, token_acl_cpi},
    quasar_lang::{cpi::Seed, prelude::*},
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[allow(dead_code)]
pub struct Freeze {
    pub authority: Signer,
    #[account(
        has_one(property_mint),
        has_one(authority) @ DvpError::Unauthorized,
        address = Offering::seeds(property_mint.address())
    )]
    pub offering: Account<Offering>,
    pub property_mint: InterfaceAccount<Mint>,
    #[account(mut)]
    pub token_account: InterfaceAccount<Token>,
    pub token_program: Interface<TokenInterface>,
}

impl Freeze {
    #[inline(always)]
    pub fn freeze(&self) -> Result<(), ProgramError> {
        require_keys_eq!(
            *self.token_account.mint(),
            *self.property_mint.address(),
            DvpError::InvalidTokenAccount
        );

        let bump = [self.offering.bump];
        let seeds = [
            Seed::from(b"offering" as &[u8]),
            Seed::from(self.property_mint.address().as_ref()),
            Seed::from(bump.as_ref()),
        ];

        token_acl_cpi::freeze_account(
            &self.token_program,
            &self.token_account,
            &self.property_mint,
            &self.offering,
        )
        .invoke_signed(&seeds)
    }
}
