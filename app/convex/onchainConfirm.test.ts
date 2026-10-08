import { describe, expect, test } from "vitest";
import { isBlockhashExpired, validateSettlePurchaseTransaction } from "./onchainConfirm";

const PROGRAM = "CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const BUYER = "Buyer111111111111111111111111111111111111111";
const MINT = "Mint1111111111111111111111111111111111111111";
const USDC = "Usdc1111111111111111111111111111111111111111";
const OFFERING = "Offering111111111111111111111111111111111111";
const AUTHORITY = "Authority11111111111111111111111111111111111";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  return "1".repeat(zeros) + encoded;
}

function settleData(amount: bigint): string {
  const data = new Uint8Array(9);
  data[0] = 1;
  let remaining = amount;
  for (let i = 1; i < 9; i += 1) {
    data[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return base58(data);
}

function fixture(amount = 5n) {
  const accounts = [
    BUYER,
    OFFERING,
    MINT,
    USDC,
    "Vault111111111111111111111111111111111111111",
    "BuyerProperty11111111111111111111111111111111",
    "BuyerUsdc111111111111111111111111111111111111",
    "Treasury1111111111111111111111111111111111111",
    "Eligibility11111111111111111111111111111111111",
    TOKEN_2022,
    TOKEN,
    AUTHORITY,
  ];
  return {
    slot: 123,
    transaction: {
      message: {
        accountKeys: [...accounts, PROGRAM].map((pubkey, index) => ({
          pubkey,
          signer: index === 0 || index === 11,
          writable: index === 0 || [1, 4, 5, 6, 7].includes(index),
        })),
        instructions: [
          { programId: PROGRAM, accounts, data: settleData(amount) },
        ],
      },
    },
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 5,
          mint: MINT,
          owner: BUYER,
          uiTokenAmount: { amount: "2", decimals: 0 },
        },
        {
          accountIndex: 6,
          mint: USDC,
          owner: BUYER,
          uiTokenAmount: { amount: "1000", decimals: 6 },
        },
        {
          accountIndex: 7,
          mint: USDC,
          owner: "TreasuryOwner",
          uiTokenAmount: { amount: "0", decimals: 6 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 5,
          mint: MINT,
          owner: BUYER,
          uiTokenAmount: { amount: (2n + amount).toString(), decimals: 0 },
        },
        {
          accountIndex: 6,
          mint: USDC,
          owner: BUYER,
          uiTokenAmount: { amount: "900", decimals: 6 },
        },
        {
          accountIndex: 7,
          mint: USDC,
          owner: "TreasuryOwner",
          uiTokenAmount: { amount: "100", decimals: 6 },
        },
      ],
    },
  };
}

function expected(amount = 5n, mint = MINT, total = 100n) {
  return new Map([
    [
      mint,
      {
        buyer: BUYER,
        propertyMint: mint,
        tokenAmountRaw: amount.toString(),
        principalBaseUnits: "99",
        platformFeeBaseUnits: (total - 99n).toString(),
        totalBaseUnits: total.toString(),
        offering: OFFERING,
        authority: AUTHORITY,
      },
    ],
  ]);
}

describe("settlePurchase chain evidence", () => {
  test("requires a block height strictly beyond the validity window", () => {
    expect(isBlockhashExpired(500, 500)).toBe(false);
    expect(isBlockhashExpired(501, 500)).toBe(true);
    expect(isBlockhashExpired(Number.NaN, 500)).toBe(false);
  });

  test("rejects a transaction that only mentions the Vesper program key", () => {
    const tx = fixture();
    tx.transaction.message.instructions = [
      {
        programId: TOKEN,
        accounts: tx.transaction.message.instructions[0].accounts,
        data: settleData(5n),
      },
    ];
    expect(() =>
      validateSettlePurchaseTransaction(tx, BUYER, new Set([MINT]), expected()),
    ).toThrow("no verifiable Vesper settlement");
  });

  test("rejects failed transactions before inspecting instructions", () => {
    const tx = fixture();
    tx.meta.err = { InstructionError: [0, "Custom"] } as never;
    expect(() =>
      validateSettlePurchaseTransaction(tx, BUYER, new Set([MINT]), expected()),
    ).toThrow("Transaction failed");
  });

  test("binds buyer, mint, account order, instruction amount, and both token deltas", () => {
    const evidence = validateSettlePurchaseTransaction(
      fixture(),
      BUYER,
      new Set([MINT]),
      expected(),
    );
    expect(evidence).toEqual([
      expect.objectContaining({
        eventIndex: 0,
        mint: MINT,
        owner: BUYER,
        tokenAmountRaw: "7",
        purchasedAmountRaw: "5",
        principalBaseUnits: "99",
        platformFeeBaseUnits: "1",
        totalBaseUnits: "100",
      }),
    ]);
  });

  test("rejects a settle whose buyer account is not the authenticated wallet", () => {
    const tx = fixture();
    tx.transaction.message.instructions[0].accounts[0] =
      "OtherBuyer11111111111111111111111111111111111";
    expect(() =>
      validateSettlePurchaseTransaction(tx, BUYER, new Set([MINT]), expected()),
    ).toThrow("no verifiable Vesper settlement");
  });

  test("retains raw u64 amounts beyond JavaScript safe integer precision", () => {
    const amount = 9_007_199_254_740_993n;
    const evidence = validateSettlePurchaseTransaction(
      fixture(amount),
      BUYER,
      new Set([MINT]),
      expected(amount),
    );
    expect(evidence[0].purchasedAmountRaw).toBe(amount.toString());
    expect(evidence[0].tokenAmountRaw).toBe((amount + 2n).toString());
  });

  test("extracts multiple settle events from one signature", () => {
    const tx = fixture();
    const secondMint = "Mint2222222222222222222222222222222222222222";
    const secondPropertyAccount =
      "BuyerProperty22222222222222222222222222222222";
    const secondAccounts = [...tx.transaction.message.instructions[0].accounts];
    secondAccounts[2] = secondMint;
    secondAccounts[5] = secondPropertyAccount;
    tx.transaction.message.accountKeys.push(
      { pubkey: secondMint, signer: false, writable: false },
      { pubkey: secondPropertyAccount, signer: false, writable: true },
    );
    const secondPropertyIndex = tx.transaction.message.accountKeys.findIndex(
      (account) => account.pubkey === secondPropertyAccount,
    );
    tx.transaction.message.instructions.push({
      programId: PROGRAM,
      accounts: secondAccounts,
      data: settleData(8n),
    });
    tx.meta.preTokenBalances.push({
      accountIndex: secondPropertyIndex,
      mint: secondMint,
      owner: BUYER,
      uiTokenAmount: { amount: "0", decimals: 0 },
    });
    tx.meta.postTokenBalances.push({
      accountIndex: secondPropertyIndex,
      mint: secondMint,
      owner: BUYER,
      uiTokenAmount: { amount: "8", decimals: 0 },
    });

    const expectedSettlements = expected();
    expectedSettlements.set(secondMint, {
      buyer: BUYER,
      propertyMint: secondMint,
      tokenAmountRaw: "8",
      principalBaseUnits: "0",
      platformFeeBaseUnits: "0",
      totalBaseUnits: "0",
      offering: OFFERING,
      authority: AUTHORITY,
    });
    const evidence = validateSettlePurchaseTransaction(
      tx,
      BUYER,
      new Set([MINT, secondMint]),
      expectedSettlements,
    );
    expect(evidence.map((event) => event.mint)).toEqual([MINT, secondMint]);
    expect(evidence.map((event) => event.eventIndex)).toEqual([0, 1]);
  });

  test("rejects missing or wrong offering authority signatures", () => {
    const missing = fixture();
    missing.transaction.message.accountKeys[11].signer = false;
    expect(() =>
      validateSettlePurchaseTransaction(
        missing,
        BUYER,
        new Set([MINT]),
        expected(),
      ),
    ).toThrow("no verifiable Vesper settlement");

    const wrong = fixture();
    wrong.transaction.message.instructions[0].accounts[11] =
      "WrongAuthority1111111111111111111111111111111";
    expect(() =>
      validateSettlePurchaseTransaction(
        wrong,
        BUYER,
        new Set([MINT]),
        expected(),
      ),
    ).toThrow("no verifiable Vesper settlement");
  });

  test("quarantines payment deltas that do not equal prepared principal plus fee", () => {
    expect(() =>
      validateSettlePurchaseTransaction(
        fixture(),
        BUYER,
        new Set([MINT]),
        expected(5n, MINT, 101n),
      ),
    ).toThrow("no verifiable Vesper settlement");
  });
});
