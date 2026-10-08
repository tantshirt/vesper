use {
    crate::{
        errors::DvpError,
        state::{Offering, OfferingInner},
    },
    quasar_lang::prelude::*,
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[allow(dead_code)]
pub struct InitializeOffering {
    #[account(mut)]
    pub authority: Signer,
    pub property_mint: InterfaceAccount<Mint>,
    pub usdc_mint: InterfaceAccount<Mint>,
    #[account(mut, init, payer = authority, address = Offering::seeds(property_mint.address()))]
    pub offering: Account<Offering>,
    #[account(token(mint = property_mint, authority = offering, token_program = property_token_program))]
    pub vault: InterfaceAccount<Token>,
    pub treasury: InterfaceAccount<Token>,
    pub property_token_program: Interface<TokenInterface>,
    pub system_program: Program<SystemProgram>,
}

impl InitializeOffering {
    #[inline(always)]
    pub fn initialize_offering(
        &mut self,
        price_per_token: u64,
        total_offering: u64,
        bumps: &InitializeOfferingBumps,
    ) -> Result<(), ProgramError> {
        require_keys_eq!(
            *self.vault.mint(),
            *self.property_mint.address(),
            DvpError::InvalidVault
        );
        require_keys_eq!(
            *self.vault.owner(),
            *self.offering.address(),
            DvpError::InvalidVault
        );
        require_keys_eq!(
            *self.treasury.mint(),
            *self.usdc_mint.address(),
            DvpError::InvalidTreasury
        );

        self.offering.set_inner(OfferingInner {
            authority: *self.authority.address(),
            property_mint: *self.property_mint.address(),
            usdc_mint: *self.usdc_mint.address(),
            treasury: *self.treasury.address(),
            vault: *self.vault.address(),
            price_per_token,
            total_offering,
            sold: 0,
            bump: bumps.offering,
            closed: false,
        });
        Ok(())
    }
}
