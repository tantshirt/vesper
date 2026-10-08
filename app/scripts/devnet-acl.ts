/**
 * Devnet proof for the Token-ACL eligibility gate (Slice 6).
 *
 * Creates a REAL frozen-by-default Token-2022 property mint (DefaultAccountState=Frozen, freeze
 * authority = offering PDA), then exercises the full compliance flow against the deployed program:
 *   - thaw and pre-mint the offering vault, then revoke the mint authority;
 *   - a buyer WITHOUT an attestation cannot buy (delivery into a frozen ATA reverts);
 *   - attest the buyer, then buy — settlement opens and closes the thaw window atomically.
 *
 * Run: npx tsx scripts/devnet-acl.ts   (env: RPC_URL, ADMIN_KEYPAIR)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getMintLen,
  ExtensionType,
  AccountState,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createThawAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
  getAccount,
  MINT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "../lib/solana/token";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  deriveOfferingPda,
  buildInitializeOfferingInstruction,
  buildSetEligibilityInstruction,
  buildSettlePurchaseTransaction,
} from "../lib/solana/dvp";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PRICE_PER_TOKEN = 50_000_000n; // $50 USDC/token
const TOTAL_OFFERING = 1000n;
const BUY_AMOUNT = 3n;
const CU_PRICE = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 50_000,
});

function loadAdmin(): Keypair {
  const path =
    process.env.ADMIN_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
  );
}

async function send(
  connection: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[],
  label: string,
): Promise<string> {
  const tx = new Transaction().add(CU_PRICE, ...ixs);
  const sig = await sendAndConfirmTransaction(
    connection,
    tx,
    [payer, ...signers],
    {
      commitment: "confirmed",
      skipPreflight: false,
    },
  );
  console.log(`  ${label}: ${sig}`);
  return sig;
}

async function bal(
  connection: Connection,
  ata: PublicKey,
  programId: PublicKey,
): Promise<bigint> {
  try {
    return (await getAccount(connection, ata, "confirmed", programId)).amount;
  } catch {
    return 0n;
  }
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadAdmin();
  const buyer = Keypair.generate();
  console.log(
    "admin:",
    admin.publicKey.toBase58(),
    "| buyer:",
    buyer.publicKey.toBase58(),
  );

  // Fund the buyer for fees (transfer, not airdrop).
  await send(
    connection,
    [
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: buyer.publicKey,
        lamports: 50_000_000,
      }),
    ],
    admin,
    [],
    "fund buyer",
  );

  // --- 1. frozen-by-default Token-2022 property mint (freeze authority = offering PDA) ---
  const propertyMint = Keypair.generate();
  const [offering] = deriveOfferingPda(propertyMint.publicKey);
  const mintLen = getMintLen([ExtensionType.DefaultAccountState]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);
  await send(
    connection,
    [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: propertyMint.publicKey,
        space: mintLen,
        lamports: mintRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeDefaultAccountStateInstruction(
        propertyMint.publicKey,
        AccountState.Frozen,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMint2Instruction(
        propertyMint.publicKey,
        0,
        admin.publicKey,
        admin.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
    ],
    admin,
    [propertyMint],
    "create frozen Token-2022 property mint",
  );

  // --- 2. mock USDC mint (classic SPL, 6 decimals) ---
  const usdcMint = Keypair.generate();
  const usdcRent =
    await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await send(
    connection,
    [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: usdcMint.publicKey,
        space: MINT_SIZE,
        lamports: usdcRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        usdcMint.publicKey,
        6,
        admin.publicKey,
        null,
        TOKEN_PROGRAM_ID,
      ),
    ],
    admin,
    [usdcMint],
    "create mock USDC mint",
  );

  // --- 3. vault + treasury + buyer USDC; fund vault before binding freeze authority ---
  const vault = getAssociatedTokenAddressSync(
    propertyMint.publicKey,
    offering,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const treasury = getAssociatedTokenAddressSync(
    usdcMint.publicKey,
    admin.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  const buyerUsdc = getAssociatedTokenAddressSync(
    usdcMint.publicKey,
    buyer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  await send(
    connection,
    [
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        vault,
        offering,
        propertyMint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        treasury,
        admin.publicKey,
        usdcMint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        buyerUsdc,
        buyer.publicKey,
        usdcMint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createThawAccountInstruction(
        vault,
        propertyMint.publicKey,
        admin.publicKey,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
      createMintToInstruction(
        propertyMint.publicKey,
        vault,
        admin.publicKey,
        TOTAL_OFFERING,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
      createSetAuthorityInstruction(
        propertyMint.publicKey,
        admin.publicKey,
        AuthorityType.FreezeAccount,
        offering,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
      createSetAuthorityInstruction(
        propertyMint.publicKey,
        admin.publicKey,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
      createMintToInstruction(
        usdcMint.publicKey,
        buyerUsdc,
        admin.publicKey,
        500_000_000n,
        [],
        TOKEN_PROGRAM_ID,
      ),
    ],
    admin,
    [],
    "create accounts + fund vault + bind freeze authority + revoke mint authority",
  );

  // --- 4. initialize the offering ---
  await send(
    connection,
    [
      buildInitializeOfferingInstruction({
        authority: admin.publicKey,
        propertyMint: propertyMint.publicKey,
        usdcMint: usdcMint.publicKey,
        offering,
        vault,
        treasury,
        pricePerToken: PRICE_PER_TOKEN,
        totalOffering: TOTAL_OFFERING,
      }),
    ],
    admin,
    [],
    "initializeOffering",
  );

  // --- 5. NEGATIVE: buyer buys WITHOUT an eligibility attestation → must fail ---
  console.log("negative path (unattested buyer):");
  let negativeFailed = false;
  try {
    const { transaction } = await buildSettlePurchaseTransaction({
      connection,
      buyer: buyer.publicKey,
      propertyMint: propertyMint.publicKey,
      tokenAmount: BUY_AMOUNT,
    });
    transaction.sign([buyer, admin]);
    await connection.sendTransaction(transaction, { skipPreflight: false });
    console.log("  ERROR: unattested buy unexpectedly succeeded");
  } catch {
    negativeFailed = true;
    console.log("  OK: unattested buy correctly rejected");
  }

  // --- 6. attest the buyer, then buy (atomic thaw/deliver/freeze) ---
  await send(
    connection,
    [
      buildSetEligibilityInstruction({
        authority: admin.publicKey,
        propertyMint: propertyMint.publicKey,
        owner: buyer.publicKey,
        eligible: true,
      }),
    ],
    admin,
    [],
    "attest buyer eligible",
  );

  const built = await buildSettlePurchaseTransaction({
    connection,
    buyer: buyer.publicKey,
    propertyMint: propertyMint.publicKey,
    tokenAmount: BUY_AMOUNT,
  });
  built.transaction.sign([buyer, admin]);
  const buySig = await connection.sendTransaction(built.transaction, {
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    {
      signature: buySig,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed",
  );
  console.log("  gated buy:", buySig);

  // --- assertions ---
  const buyerProperty = getAssociatedTokenAddressSync(
    propertyMint.publicKey,
    buyer.publicKey,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const buyerBal = await bal(connection, buyerProperty, TOKEN_2022_PROGRAM_ID);
  const treasuryBal = await bal(connection, treasury, TOKEN_PROGRAM_ID);
  const vaultBal = await bal(connection, vault, TOKEN_2022_PROGRAM_ID);
  console.log("RESULT:", {
    negativeCorrectlyFailed: negativeFailed,
    buyerProperty: buyerBal.toString(),
    treasuryUsdc: treasuryBal.toString(),
    vault: vaultBal.toString(),
  });
  const ok =
    negativeFailed &&
    buyerBal === BUY_AMOUNT &&
    treasuryBal === built.quote.totalUsdcAmount &&
    vaultBal === TOTAL_OFFERING - BUY_AMOUNT;
  console.log(ok ? "ACL DEVNET PROOF: PASS" : "ACL DEVNET PROOF: FAIL");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
