use quasar_lang::prelude::*;

#[error_code]
pub enum DvpError {
    OfferingClosed,
    ZeroAmount,
    ExceedsOffering,
    MathOverflow,
    NotEligible,
    Unauthorized,
    InvalidVault,
    InvalidTreasury,
    InvalidTokenAccount,
}
