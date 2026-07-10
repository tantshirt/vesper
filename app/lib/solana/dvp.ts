/**
 * Vesper DvP (delivery-versus-payment) client.
 *
 * Reusable, dependency-light TypeScript client for the `vesper_dvp` Quasar
 * program deployed to Solana devnet. This module is consumed both by the
 * devnet e2e proof script and by the upcoming Solana Pay endpoint, so it is
 * kept framework-agnostic (plain @solana/web3.js + @solana/spl-token, no
 * framework runtime dependency).
 *
 * Instruction data is encoded using Quasar discriminators taken verbatim from
 * the IDL, followed by borsh-encoded u64 (LE) args. The Offering
 * account is decoded manually per the on-chain `state.rs` field order.
 */

import { Buffer } from "node:buffer";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import idl from "./vesper_dvp.idl.json";

// ---------------------------------------------------------------------------
// Program + token-program ids
// ---------------------------------------------------------------------------

/** Deployed `vesper_dvp` program id (devnet). */
export const PROGRAM_ID = new PublicKey(
  "CfVrHrQoHq5tmAKPBQAtG5Eh5qrYuKQf1XrXWconD5M2",
);

/** Token-2022 program — the property token uses this. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

/** Classic SPL Token program — mock USDC uses this. */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export { ASSOCIATED_TOKEN_PROGRAM_ID };

/** PDA seed prefix for the per-property Offering account. */
export const OFFERING_SEED = Buffer.from("offering");

/** PDA seed prefix for the per-(property_mint, owner) Eligibility (Token-ACL) account. */
export const ELIGIBILITY_SEED = Buffer.from("eligibility");

// ---------------------------------------------------------------------------
// Decimals (design facts)
// ---------------------------------------------------------------------------

/** Property token: 0 decimals (whole tokens only). */
export const PROPERTY_DECIMALS = 0;
/** Mock USDC: 6 decimals. */
export const USDC_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Instruction discriminators (from the IDL)
// ---------------------------------------------------------------------------

type IdlInstruction = { name: string; discriminator: number[] };
type IdlAccount = { name: string; discriminator: number[] };

function idlInstructionDiscriminator(name: string): Buffer {
  const ix = (idl.instructions as IdlInstruction[]).find(
    (i) => i.name === name,
  );
  if (!ix) throw new Error(`Instruction "${name}" not found in IDL`);
  return Buffer.from(ix.discriminator);
}

function idlAccountDiscriminator(name: string): Buffer {
  const acc = (idl.accounts as IdlAccount[]).find((a) => a.name === name);
  if (!acc) throw new Error(`Account "${name}" not found in IDL`);
  return Buffer.from(acc.discriminator);
}

export const SETTLE_PURCHASE_DISCRIMINATOR =
  idlInstructionDiscriminator("settlePurchase");
export const INITIALIZE_OFFERING_DISCRIMINATOR = idlInstructionDiscriminator(
  "initializeOffering",
);
export const SET_ELIGIBILITY_DISCRIMINATOR =
  idlInstructionDiscriminator("setEligibility");
export const THAW_DISCRIMINATOR = idlInstructionDiscriminator("thaw");
export const FREEZE_DISCRIMINATOR = idlInstructionDiscriminator("freeze");
export const OFFERING_ACCOUNT_DISCRIMINATOR =
  idlAccountDiscriminator("Offering");

// ---------------------------------------------------------------------------
// Borsh helpers (u64 LE)
// ---------------------------------------------------------------------------

function encodeU64LE(value: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

/** Derive the Offering PDA for a property mint: seeds [b"offering", mint]. */
export function deriveOfferingPda(propertyMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [OFFERING_SEED, propertyMint.toBuffer()],
    PROGRAM_ID,
  );
}

/** Derive the Eligibility PDA: seeds [b"eligibility", property_mint, owner]. */
export function deriveEligibilityPda(
  propertyMint: PublicKey,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ELIGIBILITY_SEED, propertyMint.toBuffer(), owner.toBuffer()],
    PROGRAM_ID,
  );
}

// ---------------------------------------------------------------------------
// Offering account decode
// ---------------------------------------------------------------------------

export interface Offering {
  authority: PublicKey;
  propertyMint: PublicKey;
  usdcMint: PublicKey;
  treasury: PublicKey;
  vault: PublicKey;
  pricePerToken: bigint;
  totalOffering: bigint;
  sold: bigint;
  bump: number;
  closed: boolean;
}

/**
 * Decode a raw Offering account buffer. Layout (after the Quasar account
 * discriminator), matching state.rs field order:
 *   authority     pubkey (32)
 *   property_mint pubkey (32)
 *   usdc_mint     pubkey (32)
 *   treasury      pubkey (32)
 *   vault         pubkey (32)
 *   price_per_token u64  (8)
 *   total_offering  u64  (8)
 *   sold            u64  (8)
 *   bump            u8   (1)
 *   closed          bool (1)
 */
export function decodeOffering(data: Buffer): Offering {
  const discriminatorLength = OFFERING_ACCOUNT_DISCRIMINATOR.length;
  const disc = data.subarray(0, discriminatorLength);
  if (!disc.equals(OFFERING_ACCOUNT_DISCRIMINATOR)) {
    throw new Error(
      `Not an Offering account: discriminator ${disc.toString("hex")} != ${OFFERING_ACCOUNT_DISCRIMINATOR.toString("hex")}`,
    );
  }
  let o = discriminatorLength;
  const pk = () => {
    const key = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    return key;
  };
  const authority = pk();
  const propertyMint = pk();
  const usdcMint = pk();
  const treasury = pk();
  const vault = pk();
  const pricePerToken = readU64LE(data, o);
  o += 8;
  const totalOffering = readU64LE(data, o);
  o += 8;
  const sold = readU64LE(data, o);
  o += 8;
  const bump = data.readUInt8(o);
  o += 1;
  const closed = data.readUInt8(o) !== 0;
  o += 1;
  return {
    authority,
    propertyMint,
    usdcMint,
    treasury,
    vault,
    pricePerToken,
    totalOffering,
    sold,
    bump,
    closed,
  };
}

/** Fetch + decode the Offering account for a property mint. */
export async function fetchOffering(
  connection: Connection,
  propertyMint: PublicKey,
): Promise<{ offering: Offering; address: PublicKey }> {
  const [address] = deriveOfferingPda(propertyMint);
  const info = await connection.getAccountInfo(address);
  if (!info) {
    throw new Error(
      `Offering account ${address.toBase58()} not found for property mint ${propertyMint.toBase58()}`,
    );
  }
  return { offering: decodeOffering(Buffer.from(info.data)), address };
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

/** Derive the buyer's two ATAs (property = Token-2022, usdc = classic SPL). */
export function deriveBuyerAtas(
  buyer: PublicKey,
  propertyMint: PublicKey,
  usdcMint: PublicKey,
): { buyerProperty: PublicKey; buyerUsdc: PublicKey } {
  const buyerProperty = getAssociatedTokenAddressSync(
    propertyMint,
    buyer,
    true, // allowOwnerOffCurve — harmless for normal wallets
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const buyerUsdc = getAssociatedTokenAddressSync(
    usdcMint,
    buyer,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return { buyerProperty, buyerUsdc };
}

/**
 * Build the raw `settlePurchase` instruction. Account order + writability
 * exactly matches the program:
 *   0 buyer          signer, writable
 *   1 offering       writable (PDA)
 *   2 property_mint  readonly
 *   3 usdc_mint      readonly
 *   4 vault          writable
 *   5 buyer_property writable (Token-2022 ATA)
 *   6 buyer_usdc     writable (classic SPL ATA)
 *   7 treasury       writable
 *   8 property_token_program  readonly (Token-2022)
 *   9 usdc_token_program      readonly (classic SPL)
 */
export function buildSettlePurchaseInstruction(params: {
  buyer: PublicKey;
  offering: PublicKey;
  propertyMint: PublicKey;
  usdcMint: PublicKey;
  vault: PublicKey;
  buyerProperty: PublicKey;
  buyerUsdc: PublicKey;
  treasury: PublicKey;
  tokenAmount: bigint | number;
}): TransactionInstruction {
  const data = Buffer.concat([
    SETTLE_PURCHASE_DISCRIMINATOR,
    encodeU64LE(params.tokenAmount),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.buyer, isSigner: true, isWritable: true },
      { pubkey: params.offering, isSigner: false, isWritable: true },
      { pubkey: params.propertyMint, isSigner: false, isWritable: false },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: params.vault, isSigner: false, isWritable: true },
      { pubkey: params.buyerProperty, isSigner: false, isWritable: true },
      { pubkey: params.buyerUsdc, isSigner: false, isWritable: true },
      { pubkey: params.treasury, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build the raw `initializeOffering` instruction. Account order:
 *   0 authority      signer, writable
 *   1 property_mint  readonly
 *   2 usdc_mint      readonly
 *   3 offering       writable (PDA)
 *   4 vault          readonly (Token-2022 account owned by offering PDA)
 *   5 treasury       readonly (usdc token account)
 *   6 property_token_program readonly (Token-2022)
 *   7 system_program readonly
 */
export function buildInitializeOfferingInstruction(params: {
  authority: PublicKey;
  propertyMint: PublicKey;
  usdcMint: PublicKey;
  offering: PublicKey;
  vault: PublicKey;
  treasury: PublicKey;
  pricePerToken: bigint | number;
  totalOffering: bigint | number;
}): TransactionInstruction {
  const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
  const data = Buffer.concat([
    INITIALIZE_OFFERING_DISCRIMINATOR,
    encodeU64LE(params.pricePerToken),
    encodeU64LE(params.totalOffering),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.propertyMint, isSigner: false, isWritable: false },
      { pubkey: params.usdcMint, isSigner: false, isWritable: false },
      { pubkey: params.offering, isSigner: false, isWritable: true },
      { pubkey: params.vault, isSigner: false, isWritable: false },
      { pubkey: params.treasury, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build the raw `setEligibility` instruction (admin-only Token-ACL attestation). Account order:
 *   0 authority     signer, writable (must equal offering.authority)
 *   1 offering       readonly (PDA)
 *   2 property_mint  readonly
 *   3 owner          readonly (the investor wallet; a PDA seed, not a signer)
 *   4 eligibility    writable (PDA, init_if_needed)
 *   5 system_program readonly
 */
export function buildSetEligibilityInstruction(params: {
  authority: PublicKey;
  propertyMint: PublicKey;
  owner: PublicKey;
  eligible: boolean;
}): TransactionInstruction {
  const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
  const [offering] = deriveOfferingPda(params.propertyMint);
  const [eligibility] = deriveEligibilityPda(params.propertyMint, params.owner);
  const data = Buffer.concat([
    SET_ELIGIBILITY_DISCRIMINATOR,
    Buffer.from([params.eligible ? 1 : 0]),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: offering, isSigner: false, isWritable: false },
      { pubkey: params.propertyMint, isSigner: false, isWritable: false },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: eligibility, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build the raw `thaw` instruction (permissionless self-thaw, gated by Eligibility). Account order:
 *   0 cranker       signer, writable (whoever pays — permissionless)
 *   1 offering       readonly (PDA)
 *   2 property_mint  readonly
 *   3 token_account  writable (the account to thaw)
 *   4 owner          readonly (token account owner; keys the Eligibility PDA)
 *   5 eligibility    readonly (PDA for `owner`)
 *   6 token_program  readonly (Token-2022 for the property token)
 */
export function buildThawInstruction(params: {
  cranker: PublicKey;
  propertyMint: PublicKey;
  tokenAccount: PublicKey;
  /** Owner of `tokenAccount` — keys the Eligibility PDA. */
  owner: PublicKey;
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  const [offering] = deriveOfferingPda(params.propertyMint);
  const [eligibility] = deriveEligibilityPda(params.propertyMint, params.owner);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.cranker, isSigner: true, isWritable: true },
      { pubkey: offering, isSigner: false, isWritable: false },
      { pubkey: params.propertyMint, isSigner: false, isWritable: false },
      { pubkey: params.tokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: eligibility, isSigner: false, isWritable: false },
      {
        pubkey: params.tokenProgram ?? TOKEN_2022_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: THAW_DISCRIMINATOR,
  });
}

/**
 * Build the raw `freeze` instruction (authority-only Token-ACL enforcement). Account order:
 *   0 authority      signer, readonly (must equal offering.authority)
 *   1 offering       readonly (PDA)
 *   2 property_mint  readonly
 *   3 token_account  writable (the account to freeze)
 *   4 token_program  readonly (Token-2022 for the property token)
 */
export function buildFreezeInstruction(params: {
  authority: PublicKey;
  propertyMint: PublicKey;
  tokenAccount: PublicKey;
  tokenProgram?: PublicKey;
}): TransactionInstruction {
  const [offering] = deriveOfferingPda(params.propertyMint);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: offering, isSigner: false, isWritable: false },
      { pubkey: params.propertyMint, isSigner: false, isWritable: false },
      { pubkey: params.tokenAccount, isSigner: false, isWritable: true },
      {
        pubkey: params.tokenProgram ?? TOKEN_2022_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: FREEZE_DISCRIMINATOR,
  });
}

// ---------------------------------------------------------------------------
// High-level: build the unsigned settle transaction
// ---------------------------------------------------------------------------

export interface BuildSettlePurchaseArgs {
  connection: Connection;
  /** The buyer's public key. Also the fee payer and the only tx-level signer. */
  buyer: PublicKey;
  /** The Token-2022 property mint being purchased. */
  propertyMint: PublicKey;
  /** Number of whole property tokens to buy (base units; property has 0 decimals). */
  tokenAmount: bigint | number;
  /** Priority fee in micro-lamports per compute unit (default 50_000). */
  computeUnitPrice?: number;
  /** Optional compute-unit limit (default 200_000, enough for the CPIs). */
  computeUnitLimit?: number;
  /**
   * Whether to inject a Token-ACL `thaw` for the buyer's property ATA (after ATA creation, before
   * settle). Default is auto: thaw when the buyer's property ATA is missing or frozen — with
   * DefaultAccountState=Frozen a freshly-created ATA is frozen, so a first-time buyer thaws; a
   * returning buyer (already thawed) must NOT re-thaw (that errors). Requires the buyer's on-chain
   * Eligibility to have been attested (setEligibility) first.
   */
  includeThaw?: boolean;
}

export interface BuildSettlePurchaseResult {
  transaction: VersionedTransaction;
  offering: Offering;
  offeringAddress: PublicKey;
  buyerProperty: PublicKey;
  buyerUsdc: PublicKey;
  /** usdc base units that will be paid = tokenAmount * price_per_token. */
  usdcAmount: bigint;
  /** Whether a Token-ACL `thaw` instruction was injected before settle. */
  thawInjected: boolean;
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * Build an UNSIGNED VersionedTransaction that settles a primary purchase.
 *
 * It fetches + decodes the on-chain Offering (for vault / treasury / usdc_mint),
 * derives the buyer's two ATAs, PREPENDS idempotent ATA-creation instructions
 * (payer = buyer) for both the Token-2022 property ATA and the classic USDC ATA,
 * appends the `settlePurchase` instruction, adds compute-budget instructions,
 * sets feePayer = buyer and a fresh recentBlockhash, and returns the unsigned tx.
 *
 * The buyer signs later (single tx-level signer). The offering PDA signs the
 * delivery leg internally via CPI — that is not a transaction signature.
 */
export async function buildSettlePurchaseTransaction(
  args: BuildSettlePurchaseArgs,
): Promise<BuildSettlePurchaseResult> {
  const {
    connection,
    buyer,
    propertyMint,
    tokenAmount,
    computeUnitPrice = 50_000,
    computeUnitLimit = 200_000,
  } = args;

  const { offering, address: offeringAddress } = await fetchOffering(
    connection,
    propertyMint,
  );

  const { buyerProperty, buyerUsdc } = deriveBuyerAtas(
    buyer,
    propertyMint,
    offering.usdcMint,
  );

  // Decide whether to thaw the buyer's property ATA. Auto: a missing or frozen ATA needs the one-time
  // Token-ACL thaw; an already-thawed ATA must be left alone (re-thaw errors).
  let thawInjected: boolean;
  if (typeof args.includeThaw === "boolean") {
    thawInjected = args.includeThaw;
  } else {
    try {
      const acct = await getAccount(
        connection,
        buyerProperty,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );
      thawInjected = acct.isFrozen;
    } catch {
      thawInjected = true; // ATA doesn't exist yet → it will be created frozen in this tx
    }
  }

  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: computeUnitPrice,
    }),
    // Idempotent ATA creation — safe whether or not the ATAs already exist.
    createAssociatedTokenAccountIdempotentInstruction(
      buyer, // payer
      buyerProperty,
      buyer, // owner
      propertyMint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      buyer, // payer
      buyerUsdc,
      buyer, // owner
      offering.usdcMint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    // Token-ACL: thaw the (frozen-by-default) property ATA before delivery. Gated on-chain by the
    // buyer's Eligibility attestation; the offering PDA (mint freeze authority) signs the thaw via CPI.
    ...(thawInjected
      ? [
          buildThawInstruction({
            cranker: buyer,
            propertyMint,
            tokenAccount: buyerProperty,
            owner: buyer,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          }),
        ]
      : []),
    buildSettlePurchaseInstruction({
      buyer,
      offering: offeringAddress,
      propertyMint,
      usdcMint: offering.usdcMint,
      vault: offering.vault,
      buyerProperty,
      buyerUsdc,
      treasury: offering.treasury,
      tokenAmount,
    }),
  ];

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: buyer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);

  return {
    transaction,
    offering,
    offeringAddress,
    buyerProperty,
    buyerUsdc,
    usdcAmount: BigInt(tokenAmount) * offering.pricePerToken,
    thawInjected,
    blockhash,
    lastValidBlockHeight,
  };
}
