pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use state::*;

declare_id!("CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2");

#[program]
pub mod vesper_dvp {
    use super::*;

    /// Create an offering (config + vault/treasury binding) for one property mint.
    pub fn initialize_offering(
        ctx: Context<InitializeOffering>,
        price_per_token: u64,
        total_offering: u64,
    ) -> Result<()> {
        initialize_offering::handler(ctx, price_per_token, total_offering)
    }

    /// Atomic delivery-versus-payment: buyer pays USDC and receives property tokens, or nothing.
    pub fn settle_purchase(ctx: Context<SettlePurchase>, token_amount: u64) -> Result<()> {
        settle_purchase::handler(ctx, token_amount)
    }

    /// Token-ACL: admin writes/updates a wallet's on-chain eligibility for a property (Convex → chain).
    pub fn set_eligibility(ctx: Context<SetEligibility>, eligible: bool) -> Result<()> {
        set_eligibility::handler(ctx, eligible)
    }

    /// Token-ACL: permissionless self-thaw of an eligible wallet's token account.
    pub fn thaw(ctx: Context<Thaw>) -> Result<()> {
        thaw::handler(ctx)
    }

    /// Token-ACL: admin re-freezes a wallet's token account (compliance action).
    pub fn freeze(ctx: Context<Freeze>) -> Result<()> {
        freeze::handler(ctx)
    }
}
