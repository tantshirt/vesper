use anchor_lang::prelude::*;

#[error_code]
pub enum DvpError {
    #[msg("Offering is closed to new purchases")]
    OfferingClosed,
    #[msg("Token amount must be greater than zero")]
    ZeroAmount,
    #[msg("Purchase would exceed the offering size")]
    ExceedsOffering,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
