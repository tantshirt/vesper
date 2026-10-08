use {
    crate::{errors::DvpError, state::Offering},
    quasar_lang::prelude::*,
};

#[derive(Accounts)]
#[allow(dead_code)]
pub struct SetOfferingClosed {
    pub authority: Signer,
    #[account(
        mut,
        has_one(property_mint),
        has_one(authority) @ DvpError::Unauthorized,
        address = Offering::seeds(property_mint.address())
    )]
    pub offering: Account<Offering>,
    /// CHECK: Address-only seed input; `has_one(property_mint)` binds it to the offering.
    pub property_mint: UncheckedAccount,
}

impl SetOfferingClosed {
    #[inline(always)]
    pub fn set_offering_closed(&mut self, closed: bool) -> Result<(), ProgramError> {
        self.offering.closed = closed.into();
        Ok(())
    }
}
