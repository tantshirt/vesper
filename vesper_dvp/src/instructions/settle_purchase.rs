use {
    crate::{errors::DvpError, events::PurchaseSettled, state::Offering},
    quasar_lang::{cpi::Seed, prelude::*},
    quasar_spl::prelude::*,
};

#[derive(Accounts)]
pub struct SettlePurchase {
    #[account(mut)]
    pub buyer: Signer,
    #[account(
        mut,
        has_one(property_mint),
        has_one(usdc_mint),
        has_one(vault),
        has_one(treasury),
        address = Offering::seeds(property_mint.address())
    )]
    pub offering: Account<Offering>,
    pub property_mint: InterfaceAccount<Mint>,
    pub usdc_mint: InterfaceAccount<Mint>,
    #[account(mut, token(mint = property_mint, authority = offering, token_program = property_token_program))]
    pub vault: InterfaceAccount<Token>,
    #[account(mut, token(mint = property_mint, authority = buyer, token_program = property_token_program))]
    pub buyer_property: InterfaceAccount<Token>,
    #[account(mut, token(mint = usdc_mint, authority = buyer, token_program = usdc_token_program))]
    pub buyer_usdc: InterfaceAccount<Token>,
    #[account(mut)]
    pub treasury: InterfaceAccount<Token>,
    pub property_token_program: Interface<TokenInterface>,
    pub usdc_token_program: Interface<TokenInterface>,
}

impl SettlePurchase {
    #[inline(always)]
    pub fn settle_purchase(&mut self, token_amount: u64) -> Result<(), ProgramError> {
        require!(!self.offering.closed.get(), DvpError::OfferingClosed);
        require!(token_amount > 0, DvpError::ZeroAmount);
        require_keys_eq!(
            *self.treasury.mint(),
            *self.usdc_mint.address(),
            DvpError::InvalidTreasury
        );

        let sold_after = self
            .offering
            .sold
            .get()
            .checked_add(token_amount)
            .ok_or(DvpError::MathOverflow)?;
        require!(
            sold_after <= self.offering.total_offering.get(),
            DvpError::ExceedsOffering
        );

        let usdc_amount = token_amount
            .checked_mul(self.offering.price_per_token.get())
            .ok_or(DvpError::MathOverflow)?;

        self.usdc_token_program
            .transfer_checked(
                &self.buyer_usdc,
                &self.usdc_mint,
                &self.treasury,
                &self.buyer,
                usdc_amount,
                self.usdc_mint.decimals,
            )
            .invoke()?;

        let bump = [self.offering.bump];
        let seeds = [
            Seed::from(b"offering" as &[u8]),
            Seed::from(self.property_mint.address().as_ref()),
            Seed::from(bump.as_ref()),
        ];

        self.property_token_program
            .transfer_checked(
                &self.vault,
                &self.property_mint,
                &self.buyer_property,
                &self.offering,
                token_amount,
                self.property_mint.decimals,
            )
            .invoke_signed(&seeds)?;

        self.offering.sold = sold_after.into();

        emit!(PurchaseSettled {
            offering: *self.offering.address(),
            buyer: *self.buyer.address(),
            property_mint: *self.property_mint.address(),
            token_amount,
            usdc_amount,
            sold_after,
        });

        Ok(())
    }
}
