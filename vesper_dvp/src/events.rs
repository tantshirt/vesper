use quasar_lang::prelude::*;

#[event(discriminator = 0)]
pub struct PurchaseSettled {
    pub offering: Address,
    pub buyer: Address,
    pub property_mint: Address,
    pub token_amount: u64,
    pub principal_usdc_amount: u64,
    pub platform_fee_usdc_amount: u64,
    pub total_usdc_amount: u64,
    pub sold_after: u64,
}
