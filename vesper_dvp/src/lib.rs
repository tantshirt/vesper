#![cfg_attr(not(test), no_std)]

use quasar_lang::prelude::*;

mod errors;
mod events;
mod instructions;
mod state;
mod token_acl_cpi;

pub use errors::*;
pub use events::*;
pub use state::*;

use instructions::*;

declare_id!("CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2");

#[program]
mod vesper_dvp {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn initialize_offering(
        ctx: Ctx<InitializeOffering>,
        price_per_token: u64,
        total_offering: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .initialize_offering(price_per_token, total_offering, &ctx.bumps)
    }

    #[instruction(discriminator = 1)]
    pub fn settle_purchase(
        ctx: Ctx<SettlePurchase>,
        token_amount: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.settle_purchase(token_amount)
    }

    #[instruction(discriminator = 2)]
    pub fn set_eligibility(ctx: Ctx<SetEligibility>, eligible: bool) -> Result<(), ProgramError> {
        ctx.accounts.set_eligibility(eligible, &ctx.bumps)
    }

    #[instruction(discriminator = 3)]
    pub fn thaw(ctx: Ctx<Thaw>) -> Result<(), ProgramError> {
        ctx.accounts.thaw()
    }

    #[instruction(discriminator = 4)]
    pub fn freeze(ctx: Ctx<Freeze>) -> Result<(), ProgramError> {
        ctx.accounts.freeze()
    }
}
