use {
    crate::{
        errors::DvpError,
        state::{Eligibility, EligibilityInner, Offering},
    },
    quasar_lang::prelude::*,
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
#[allow(dead_code)]
pub struct SetEligibility {
    #[account(mut)]
    pub authority: Signer,
    #[account(
        has_one(property_mint),
        has_one(authority) @ DvpError::Unauthorized,
        address = Offering::seeds(property_mint.address())
    )]
    pub offering: Account<Offering>,
    pub property_mint: InterfaceAccount<Mint>,
    pub owner: UncheckedAccount,
    #[account(mut, init(idempotent), payer = authority, address = Eligibility::seeds(property_mint.address(), owner.address()))]
    pub eligibility: Account<Eligibility>,
    pub system_program: Program<SystemProgram>,
}

impl SetEligibility {
    #[inline(always)]
    pub fn set_eligibility(
        &mut self,
        eligible: bool,
        bumps: &SetEligibilityBumps,
    ) -> Result<(), ProgramError> {
        self.eligibility.set_inner(EligibilityInner {
            property_mint: *self.property_mint.address(),
            owner: *self.owner.address(),
            eligible,
            bump: bumps.eligibility,
        });
        Ok(())
    }
}
