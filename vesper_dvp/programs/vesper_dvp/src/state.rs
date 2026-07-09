use anchor_lang::prelude::*;

/// One `Offering` per property mint. It is the on-chain config for a primary issuance AND the
/// authority (PDA) over the pre-minted property-token vault. Delivery (vault -> buyer) can only be
/// signed by this PDA, so tokens never leave the vault except through `settle_purchase` — which is
/// what binds delivery to payment.
#[account]
#[derive(InitSpace)]
pub struct Offering {
    /// Platform admin authorized to initialize / close the offering.
    pub authority: Pubkey,
    /// The Token-2022 property mint (one dedicated mint per property).
    pub property_mint: Pubkey,
    /// The payment mint (USDC).
    pub usdc_mint: Pubkey,
    /// Treasury token account (USDC) — the payment destination.
    pub treasury: Pubkey,
    /// Program-owned property-token vault (owned by this PDA) — the delivery source.
    pub vault: Pubkey,
    /// Price in USDC base units per ONE property-token base unit. usdc = token_amount * price.
    pub price_per_token: u64,
    /// Total property tokens offered (the offering size / cap).
    pub total_offering: u64,
    /// Cumulative tokens sold. Invariant: sold <= total_offering.
    pub sold: u64,
    /// PDA bump for [b"offering", property_mint].
    pub bump: u8,
    /// When true, no further purchases settle.
    pub closed: bool,
}

/// Emitted on every settled primary purchase. Helius indexes this into the Convex reconcile mirror
/// (reconcile.applyChainEvent) — chain stays authoritative, Convex mirrors.
#[event]
pub struct PurchaseSettled {
    pub offering: Pubkey,
    pub buyer: Pubkey,
    pub property_mint: Pubkey,
    pub token_amount: u64,
    pub usdc_amount: u64,
    pub sold_after: u64,
}
