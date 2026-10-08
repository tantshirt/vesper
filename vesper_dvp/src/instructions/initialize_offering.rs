use {
    crate::{
        errors::DvpError,
        state::{Offering, OfferingInner},
    },
    quasar_lang::prelude::*,
    quasar_spl::prelude::*,
};

const PROPERTY_DECIMALS: u8 = 0;
const PAYMENT_DECIMALS: u8 = 6;
const MINT_BASE_LEN: usize = 82;
const EXTENDED_BASE_LEN: usize = 165;
const ACCOUNT_TYPE_MINT: u8 = 1;
const DEFAULT_ACCOUNT_STATE_EXTENSION: u16 = 6;
const ACCOUNT_STATE_FROZEN: u8 = 2;

#[derive(Accounts)]
#[allow(dead_code)]
pub struct InitializeOffering {
    #[account(mut)]
    pub authority: Signer,
    pub property_mint: Account<Mint2022>,
    pub usdc_mint: Account<Mint>,
    #[account(mut, init, payer = authority, address = Offering::seeds(property_mint.address()))]
    pub offering: Account<Offering>,
    #[account(token(mint = property_mint, authority = offering, token_program = property_token_program))]
    pub vault: Account<Token2022>,
    pub treasury: Account<Token>,
    pub property_token_program: Program<Token2022Program>,
    pub usdc_token_program: Program<TokenProgram>,
    pub system_program: Program<SystemProgram>,
}

impl InitializeOffering {
    #[inline(always)]
    pub fn initialize_offering(
        &mut self,
        price_per_token: u64,
        total_offering: u64,
        bumps: &InitializeOfferingBumps,
    ) -> Result<(), ProgramError> {
        require!(price_per_token > 0, DvpError::ZeroAmount);
        require!(total_offering > 0, DvpError::ZeroAmount);

        require!(
            self.property_mint.is_initialized()
                && self.property_mint.decimals == PROPERTY_DECIMALS
                && self.property_mint.mint_authority().is_none()
                && self.property_mint.supply.get() == total_offering
                && self
                    .property_mint
                    .freeze_authority()
                    .is_some_and(|authority| authority == self.offering.address()),
            DvpError::InvalidPropertyMint
        );
        require!(
            self.usdc_mint.decimals == PAYMENT_DECIMALS,
            DvpError::InvalidPaymentMint
        );
        validate_default_frozen_policy(self.property_mint.to_account_view())?;

        require_keys_eq!(
            *self.vault.mint(),
            *self.property_mint.address(),
            DvpError::InvalidVault
        );
        require_keys_eq!(
            *self.vault.owner(),
            *self.offering.address(),
            DvpError::InvalidVault
        );
        require_keys_eq!(
            *self.treasury.mint(),
            *self.usdc_mint.address(),
            DvpError::InvalidTreasury
        );
        require!(
            self.vault.amount.get() == total_offering,
            DvpError::InsufficientVaultInventory
        );

        self.offering.set_inner(OfferingInner {
            authority: *self.authority.address(),
            property_mint: *self.property_mint.address(),
            usdc_mint: *self.usdc_mint.address(),
            treasury: *self.treasury.address(),
            vault: *self.vault.address(),
            price_per_token,
            total_offering,
            sold: 0,
            bump: bumps.offering,
            closed: false,
        });
        Ok(())
    }
}

#[inline(always)]
fn validate_default_frozen_policy(mint: &AccountView) -> Result<(), ProgramError> {
    let data = mint.try_borrow()?;
    require!(
        data.len() > EXTENDED_BASE_LEN && data[EXTENDED_BASE_LEN] == ACCOUNT_TYPE_MINT,
        DvpError::InvalidPropertyMint
    );
    require!(
        data[MINT_BASE_LEN..EXTENDED_BASE_LEN]
            .iter()
            .all(|byte| *byte == 0),
        DvpError::InvalidPropertyMint
    );

    let mut offset = EXTENDED_BASE_LEN + 1;
    let mut found_default_frozen = false;
    while offset < data.len() {
        if data[offset..].iter().all(|byte| *byte == 0) {
            break;
        }
        require!(
            data.len().saturating_sub(offset) >= 4,
            DvpError::InvalidPropertyMint
        );
        let extension_type = u16::from_le_bytes([data[offset], data[offset + 1]]);
        let extension_len = u16::from_le_bytes([data[offset + 2], data[offset + 3]]) as usize;
        offset = offset.checked_add(4).ok_or(DvpError::InvalidPropertyMint)?;
        let extension_end = offset
            .checked_add(extension_len)
            .ok_or(DvpError::InvalidPropertyMint)?;
        require!(extension_end <= data.len(), DvpError::InvalidPropertyMint);
        require!(
            extension_type == DEFAULT_ACCOUNT_STATE_EXTENSION,
            DvpError::UnsupportedMintExtension
        );
        require!(
            !found_default_frozen && extension_len == 1 && data[offset] == ACCOUNT_STATE_FROZEN,
            DvpError::InvalidPropertyMint
        );
        found_default_frozen = true;
        offset = extension_end;
    }

    require!(found_default_frozen, DvpError::InvalidPropertyMint);
    Ok(())
}
