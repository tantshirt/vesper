use {
    crate::{
        errors::DvpError,
        events::PurchaseSettled,
        state::{Eligibility, Offering},
        token_acl_cpi,
    },
    quasar_lang::{cpi::Seed, prelude::*},
    quasar_spl::prelude::*,
};

pub const PLATFORM_FEE_BPS: u128 = 90;
const BPS_DENOMINATOR: u128 = 10_000;
// Payment mints are fixed at 6 decimals; 10_000 base units is one USD cent.
const PAYMENT_CENT_BASE_UNITS: u128 = 10_000;

#[derive(Debug, PartialEq, Eq)]
pub struct PurchaseAmounts {
    pub principal: u64,
    pub platform_fee: u64,
    pub total: u64,
}

/// Calculate the exact chain charge. The 90-bps fee is rounded half-up to the nearest payment cent,
/// matching the ratified order preview; no annual management fee is added at settlement.
pub fn calculate_purchase_amounts(
    token_amount: u64,
    price_per_token: u64,
) -> Result<PurchaseAmounts, DvpError> {
    let principal = u128::from(token_amount)
        .checked_mul(u128::from(price_per_token))
        .ok_or(DvpError::MathOverflow)?;
    let principal_u64 = u64::try_from(principal).map_err(|_| DvpError::MathOverflow)?;

    let fee_rounding_denominator = BPS_DENOMINATOR
        .checked_mul(PAYMENT_CENT_BASE_UNITS)
        .ok_or(DvpError::MathOverflow)?;
    let fee_numerator = principal
        .checked_mul(PLATFORM_FEE_BPS)
        .ok_or(DvpError::MathOverflow)?;
    let fee_cents = fee_numerator
        .checked_add(fee_rounding_denominator / 2)
        .ok_or(DvpError::MathOverflow)?
        .checked_div(fee_rounding_denominator)
        .ok_or(DvpError::MathOverflow)?;
    let platform_fee = fee_cents
        .checked_mul(PAYMENT_CENT_BASE_UNITS)
        .ok_or(DvpError::MathOverflow)?;
    let platform_fee_u64 = u64::try_from(platform_fee).map_err(|_| DvpError::MathOverflow)?;
    let total = principal_u64
        .checked_add(platform_fee_u64)
        .ok_or(DvpError::MathOverflow)?;

    Ok(PurchaseAmounts {
        principal: principal_u64,
        platform_fee: platform_fee_u64,
        total,
    })
}

#[derive(Accounts)]
#[allow(dead_code)]
pub struct SettlePurchase {
    #[account(mut)]
    pub buyer: Signer,
    #[account(
        mut,
        has_one(property_mint),
        has_one(usdc_mint),
        has_one(vault),
        has_one(treasury),
        has_one(authority) @ DvpError::Unauthorized,
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
    #[account(
        address = Eligibility::seeds(property_mint.address(), buyer.address()),
        constraints(eligibility.eligible.into()) @ DvpError::NotEligible
    )]
    pub eligibility: Account<Eligibility>,
    pub property_token_program: Interface<TokenInterface>,
    pub usdc_token_program: Interface<TokenInterface>,
    pub authority: Signer,
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
        require!(
            self.buyer_property.is_frozen(),
            DvpError::TokenAccountMustBeFrozen
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

        let amounts =
            calculate_purchase_amounts(token_amount, self.offering.price_per_token.get())?;

        self.usdc_token_program
            .transfer_checked(
                &self.buyer_usdc,
                &self.usdc_mint,
                &self.treasury,
                &self.buyer,
                amounts.total,
                self.usdc_mint.decimals,
            )
            .invoke()?;

        let bump = [self.offering.bump];
        let seeds = [
            Seed::from(b"offering" as &[u8]),
            Seed::from(self.property_mint.address().as_ref()),
            Seed::from(bump.as_ref()),
        ];

        token_acl_cpi::thaw_account(
            &self.property_token_program,
            &self.buyer_property,
            &self.property_mint,
            &self.offering,
        )
        .invoke_signed(&seeds)?;

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

        token_acl_cpi::freeze_account(
            &self.property_token_program,
            &self.buyer_property,
            &self.property_mint,
            &self.offering,
        )
        .invoke_signed(&seeds)?;

        self.offering.sold = sold_after.into();

        emit!(PurchaseSettled {
            offering: *self.offering.address(),
            buyer: *self.buyer.address(),
            property_mint: *self.property_mint.address(),
            token_amount,
            principal_usdc_amount: amounts.principal,
            platform_fee_usdc_amount: amounts.platform_fee,
            total_usdc_amount: amounts.total,
            sold_after,
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn amounts(token_amount: u64, price_per_token: u64) -> PurchaseAmounts {
        match calculate_purchase_amounts(token_amount, price_per_token) {
            Ok(amounts) => amounts,
            Err(_) => panic!("purchase amount calculation should succeed"),
        }
    }

    #[test]
    fn worked_fee_value_matches_preview() {
        assert_eq!(
            amounts(2, 50_000_000),
            PurchaseAmounts {
                principal: 100_000_000,
                platform_fee: 900_000,
                total: 100_900_000,
            }
        );
    }

    #[test]
    fn fee_rounds_half_up_to_payment_cents() {
        assert_eq!(amounts(1, 555_555).platform_fee, 0);
        assert_eq!(amounts(1, 555_556).platform_fee, 10_000);
    }

    #[test]
    fn principal_or_total_overflow_fails_closed() {
        assert!(matches!(
            calculate_purchase_amounts(2, u64::MAX),
            Err(DvpError::MathOverflow)
        ));
        assert!(matches!(
            calculate_purchase_amounts(1, u64::MAX),
            Err(DvpError::MathOverflow)
        ));
    }
}
