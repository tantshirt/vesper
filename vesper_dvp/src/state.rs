use quasar_lang::prelude::*;

#[account(discriminator = 1, set_inner)]
#[seeds(b"offering", property_mint: Address)]
pub struct Offering {
    pub authority: Address,
    pub property_mint: Address,
    pub usdc_mint: Address,
    pub treasury: Address,
    pub vault: Address,
    pub price_per_token: u64,
    pub total_offering: u64,
    pub sold: u64,
    pub bump: u8,
    pub closed: bool,
}

#[account(discriminator = 2, set_inner)]
#[seeds(b"eligibility", property_mint: Address, owner: Address)]
pub struct Eligibility {
    pub property_mint: Address,
    pub owner: Address,
    pub eligible: bool,
    pub bump: u8,
}
