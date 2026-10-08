use quasar_lang::{
    cpi::{CpiCall, InstructionAccount},
    prelude::*,
};

const FREEZE_ACCOUNT: u8 = 10;
const THAW_ACCOUNT: u8 = 11;

#[inline(always)]
pub fn freeze_account<'a>(
    token_program: &'a impl AsAccountView,
    account: &'a impl AsAccountView,
    mint: &'a impl AsAccountView,
    authority: &'a impl AsAccountView,
) -> CpiCall<'a, 3, 1> {
    let token_program = token_program.to_account_view();
    let account = account.to_account_view();
    let mint = mint.to_account_view();
    let authority = authority.to_account_view();

    CpiCall::new(
        token_program.address(),
        [
            InstructionAccount::writable(account.address()),
            InstructionAccount::readonly(mint.address()),
            InstructionAccount::readonly_signer(authority.address()),
        ],
        [account, mint, authority],
        [FREEZE_ACCOUNT],
    )
}

#[inline(always)]
pub fn thaw_account<'a>(
    token_program: &'a impl AsAccountView,
    account: &'a impl AsAccountView,
    mint: &'a impl AsAccountView,
    authority: &'a impl AsAccountView,
) -> CpiCall<'a, 3, 1> {
    let token_program = token_program.to_account_view();
    let account = account.to_account_view();
    let mint = mint.to_account_view();
    let authority = authority.to_account_view();

    CpiCall::new(
        token_program.address(),
        [
            InstructionAccount::writable(account.address()),
            InstructionAccount::readonly(mint.address()),
            InstructionAccount::readonly_signer(authority.address()),
        ],
        [account, mint, authority],
        [THAW_ACCOUNT],
    )
}
