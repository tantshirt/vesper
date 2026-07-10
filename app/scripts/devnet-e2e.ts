/**
 * Vesper DvP — devnet end-to-end proof.
 *
 * Proves a REAL on-chain primary purchase against the deployed `vesper_dvp`
 * program using the reusable client in app/lib/solana/dvp.ts.
 *
 * Flow (all against the configured cluster, with priority fees + confirmations):
 *   1. create a mock USDC mint (classic SPL, 6 decimals; authority = admin/payer)
 *   2. create a Token-2022 property mint (0 decimals; authority = admin)
 *   3. create the offering PDA's vault (Token-2022 ATA owned by the PDA) and
 *      pre-mint the full offering into it
 *   4. create a treasury USDC account (admin's USDC ATA)
 *   5. create a fresh buyer keypair funded via SystemProgram.transfer (NOT airdrop)
 *   6. create + fund the buyer's USDC ATA (mint mock USDC to it)
 *   7. initializeOffering (admin signs)
 *   8. build the settle tx via buildSettlePurchaseTransaction, sign as buyer, send
 *   9. assert post-state and print every signature + explorer link
 *  10. persist created addresses to app/scripts/devnet-e2e.out.json
 *
 * Run:  npx tsx app/scripts/devnet-e2e.ts
 * Env:  RPC_URL (default https://api.devnet.solana.com)
 *       ADMIN_KEYPAIR (default ~/.config/solana/id.json)
 *       CLUSTER (explorer label, default "devnet")
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  getMintLen,
  getMinimumBalanceForRentExemptMint,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  PROPERTY_DECIMALS,
  USDC_DECIMALS,
  deriveOfferingPda,
  buildInitializeOfferingInstruction,
  buildSettlePurchaseTransaction,
} from "../lib/solana/dvp";

// ---------------------------------------------------------------------------
// Config / economics
// ---------------------------------------------------------------------------

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const CLUSTER = process.env.CLUSTER ?? "devnet";
const ADMIN_KEYPAIR_PATH =
  process.env.ADMIN_KEYPAIR ?? join(homedir(), ".config/solana/id.json");

const COMPUTE_UNIT_PRICE = 100_000; // micro-lamports per CU (priority fee)
const COMPUTE_UNIT_LIMIT = 250_000;

// Offering economics (base units; property = 0 decimals, usdc = 6 decimals)
const PRICE_PER_TOKEN = 50_000_000n; // 50 USDC per property token
const TOTAL_OFFERING = 1_000n; // 1000 property tokens offered
const PURCHASE_AMOUNT = 10n; // buyer buys 10 tokens => 500 USDC
const BUYER_USDC_FUNDING = 1_000_000_000n; // 1000 USDC minted to buyer
const BUYER_SOL_FUNDING = 0.05 * LAMPORTS_PER_SOL; // rent + fees

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function explorer(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}
function explorerAddr(addr: PublicKey): string {
  return `https://explorer.solana.com/address/${addr.toBase58()}?cluster=${CLUSTER}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a legacy Transaction (built from `instructions`) with priority fees and
 * confirmation, retrying on transient RPC/throttle failures.
 */
async function sendIxs(
  connection: Connection,
  label: string,
  payer: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = [],
): Promise<string> {
  const withBudget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: COMPUTE_UNIT_PRICE,
    }),
    ...instructions,
  ];

  const maxAttempts = 6;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const tx = new Transaction().add(...withBudget);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = payer.publicKey;
      const sig = await sendAndConfirmTransaction(
        connection,
        tx,
        [payer, ...extraSigners],
        { commitment: "confirmed", maxRetries: 5 },
      );
      console.log(`  [ok] ${label}: ${sig}`);
      console.log(`       ${explorer(sig)}`);
      return sig;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `  [retry ${attempt}/${maxAttempts}] ${label} failed: ${msg}`,
      );
      await sleep(1500 * attempt);
    }
  }
  throw new Error(
    `"${label}" failed after ${maxAttempts} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

async function tokenBalance(
  connection: Connection,
  account: PublicKey,
): Promise<bigint> {
  const res = await connection.getTokenAccountBalance(account, "confirmed");
  return BigInt(res.value.amount);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair(ADMIN_KEYPAIR_PATH);

  console.log("=".repeat(72));
  console.log("Vesper DvP devnet e2e");
  console.log("=".repeat(72));
  console.log(`Cluster / RPC : ${CLUSTER} / ${RPC_URL}`);
  console.log(`Program id    : ${PROGRAM_ID.toBase58()}`);
  console.log(`Admin / payer : ${admin.publicKey.toBase58()}`);

  const adminBalance = await connection.getBalance(admin.publicKey);
  console.log(`Admin balance : ${(adminBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (adminBalance < 0.2 * LAMPORTS_PER_SOL) {
    throw new Error("Admin balance too low (< 0.2 SOL). Fund the admin keypair.");
  }

  const sigs: Record<string, string> = {};

  // --- 1. Mock USDC mint (classic SPL, 6 decimals) -----------------------
  const usdcMint = Keypair.generate();
  {
    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const ixs = [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: usdcMint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        usdcMint.publicKey,
        USDC_DECIMALS,
        admin.publicKey, // mint authority
        null, // freeze authority
        TOKEN_PROGRAM_ID,
      ),
    ];
    sigs.createUsdcMint = await sendIxs(
      connection,
      "create mock USDC mint (classic SPL, 6dp)",
      admin,
      ixs,
      [usdcMint],
    );
    console.log(`  usdc_mint = ${usdcMint.publicKey.toBase58()}`);
  }

  // --- 2. Property mint (Token-2022, 0 decimals) -------------------------
  const propertyMint = Keypair.generate();
  {
    const space = getMintLen([]); // basic Token-2022 mint, no extensions
    const lamports =
      await connection.getMinimumBalanceForRentExemption(space);
    const ixs = [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: propertyMint.publicKey,
        space,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        propertyMint.publicKey,
        PROPERTY_DECIMALS,
        admin.publicKey, // mint authority
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    ];
    sigs.createPropertyMint = await sendIxs(
      connection,
      "create property mint (Token-2022, 0dp)",
      admin,
      ixs,
      [propertyMint],
    );
    console.log(`  property_mint = ${propertyMint.publicKey.toBase58()}`);
  }

  // --- 3. Offering PDA + vault (Token-2022 ATA owned by PDA) + pre-mint ---
  const [offeringPda, offeringBump] = deriveOfferingPda(propertyMint.publicKey);
  console.log(`  offering PDA = ${offeringPda.toBase58()} (bump ${offeringBump})`);

  const vault = getAssociatedTokenAddressSync(
    propertyMint.publicKey,
    offeringPda,
    true, // allowOwnerOffCurve — the owner is a PDA
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  {
    const ixs = [
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey, // payer
        vault,
        offeringPda, // owner = PDA
        propertyMint.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToInstruction(
        propertyMint.publicKey,
        vault,
        admin.publicKey, // mint authority
        TOTAL_OFFERING,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    ];
    sigs.createVaultAndMint = await sendIxs(
      connection,
      `create vault + pre-mint ${TOTAL_OFFERING} property tokens`,
      admin,
      ixs,
    );
    console.log(`  vault = ${vault.toBase58()}`);
  }

  // --- 4. Treasury USDC account (admin's USDC ATA) -----------------------
  const treasury = getAssociatedTokenAddressSync(
    usdcMint.publicKey,
    admin.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  {
    const ixs = [
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey,
        treasury,
        admin.publicKey,
        usdcMint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    ];
    sigs.createTreasury = await sendIxs(
      connection,
      "create treasury USDC account",
      admin,
      ixs,
    );
    console.log(`  treasury = ${treasury.toBase58()}`);
  }

  // --- 5. Fresh buyer, funded via transfer (NOT airdrop) -----------------
  const buyer = Keypair.generate();
  {
    const ixs = [
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: buyer.publicKey,
        lamports: BUYER_SOL_FUNDING,
      }),
    ];
    sigs.fundBuyer = await sendIxs(
      connection,
      `fund buyer ${(BUYER_SOL_FUNDING / LAMPORTS_PER_SOL).toFixed(3)} SOL via transfer`,
      admin,
      ixs,
    );
    console.log(`  buyer = ${buyer.publicKey.toBase58()}`);
  }

  // --- 6. Buyer USDC ATA + fund it (mint mock USDC) ----------------------
  const buyerUsdc = getAssociatedTokenAddressSync(
    usdcMint.publicKey,
    buyer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  {
    const ixs = [
      createAssociatedTokenAccountIdempotentInstruction(
        admin.publicKey, // admin pays for the ATA rent
        buyerUsdc,
        buyer.publicKey, // owner
        usdcMint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createMintToInstruction(
        usdcMint.publicKey,
        buyerUsdc,
        admin.publicKey,
        BUYER_USDC_FUNDING,
        [],
        TOKEN_PROGRAM_ID,
      ),
    ];
    sigs.fundBuyerUsdc = await sendIxs(
      connection,
      `create + fund buyer USDC ATA (${BUYER_USDC_FUNDING} base units)`,
      admin,
      ixs,
    );
    console.log(`  buyer_usdc = ${buyerUsdc.toBase58()}`);
  }

  // --- 7. initializeOffering --------------------------------------------
  {
    const ix = buildInitializeOfferingInstruction({
      authority: admin.publicKey,
      propertyMint: propertyMint.publicKey,
      usdcMint: usdcMint.publicKey,
      offering: offeringPda,
      vault,
      treasury,
      pricePerToken: PRICE_PER_TOKEN,
      totalOffering: TOTAL_OFFERING,
    });
    sigs.initializeOffering = await sendIxs(
      connection,
      `initializeOffering (price=${PRICE_PER_TOKEN}, total=${TOTAL_OFFERING})`,
      admin,
      [ix],
    );
  }

  // --- capture pre-state --------------------------------------------------
  const vaultBefore = await tokenBalance(connection, vault);
  const treasuryBefore = await tokenBalance(connection, treasury);
  console.log("-".repeat(72));
  console.log(`Pre-buy  : vault=${vaultBefore}  treasury=${treasuryBefore}`);

  // --- 8. build settle tx via the reusable client, sign as buyer, send ---
  const built = await buildSettlePurchaseTransaction({
    connection,
    buyer: buyer.publicKey,
    propertyMint: propertyMint.publicKey,
    tokenAmount: PURCHASE_AMOUNT,
    computeUnitPrice: COMPUTE_UNIT_PRICE,
    computeUnitLimit: COMPUTE_UNIT_LIMIT,
  });
  console.log(
    `Settle   : buying ${PURCHASE_AMOUNT} tokens for ${built.usdcAmount} USDC base units`,
  );

  // buyer is the only tx-level signer
  built.transaction.sign([buyer]);

  let settleSig = "";
  {
    const maxAttempts = 8;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        settleSig = await connection.sendRawTransaction(
          built.transaction.serialize(),
          { skipPreflight: false, maxRetries: 5 },
        );
        const conf = await connection.confirmTransaction(
          {
            signature: settleSig,
            blockhash: built.blockhash,
            lastValidBlockHeight: built.lastValidBlockHeight,
          },
          "confirmed",
        );
        if (conf.value.err) {
          throw new Error(`tx error: ${JSON.stringify(conf.value.err)}`);
        }
        break;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `  [settle retry ${attempt}/${maxAttempts}] ${msg}`,
        );
        if (msg.includes("block height exceeded") || msg.includes("Blockhash")) {
          // stale blockhash — rebuild + re-sign
          const rebuilt = await buildSettlePurchaseTransaction({
            connection,
            buyer: buyer.publicKey,
            propertyMint: propertyMint.publicKey,
            tokenAmount: PURCHASE_AMOUNT,
            computeUnitPrice: COMPUTE_UNIT_PRICE,
            computeUnitLimit: COMPUTE_UNIT_LIMIT,
          });
          rebuilt.transaction.sign([buyer]);
          built.transaction = rebuilt.transaction;
          built.blockhash = rebuilt.blockhash;
          built.lastValidBlockHeight = rebuilt.lastValidBlockHeight;
        }
        if (attempt === maxAttempts) {
          throw new Error(
            `settlePurchase failed after ${maxAttempts} attempts: ${msg}`,
          );
        }
        await sleep(1500 * attempt);
      }
    }
  }
  sigs.settlePurchase = settleSig;
  console.log(`  [ok] settlePurchase: ${settleSig}`);
  console.log(`       ${explorer(settleSig)}`);

  // --- 9. assert post-state ----------------------------------------------
  const expectedUsdc = PURCHASE_AMOUNT * PRICE_PER_TOKEN;
  const buyerProperty = built.buyerProperty;
  const buyerPropBal = await tokenBalance(connection, buyerProperty);
  const vaultAfter = await tokenBalance(connection, vault);
  const treasuryAfter = await tokenBalance(connection, treasury);

  console.log("-".repeat(72));
  console.log(`Post-buy : buyer_property=${buyerPropBal}  vault=${vaultAfter}  treasury=${treasuryAfter}`);

  const checks: Array<[string, boolean, string]> = [
    [
      "buyer_property == purchased tokens",
      buyerPropBal === PURCHASE_AMOUNT,
      `got ${buyerPropBal}, want ${PURCHASE_AMOUNT}`,
    ],
    [
      "treasury increased by tokens*price",
      treasuryAfter - treasuryBefore === expectedUsdc,
      `delta ${treasuryAfter - treasuryBefore}, want ${expectedUsdc}`,
    ],
    [
      "vault decreased by purchased tokens",
      vaultBefore - vaultAfter === PURCHASE_AMOUNT,
      `delta ${vaultBefore - vaultAfter}, want ${PURCHASE_AMOUNT}`,
    ],
  ];

  console.log("-".repeat(72));
  let allPass = true;
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  (${detail})`);
    if (!pass) allPass = false;
  }

  // --- 10. persist addresses ---------------------------------------------
  const out = {
    cluster: CLUSTER,
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID.toBase58(),
    admin: admin.publicKey.toBase58(),
    usdcMint: usdcMint.publicKey.toBase58(),
    propertyMint: propertyMint.publicKey.toBase58(),
    offering: offeringPda.toBase58(),
    offeringBump,
    vault: vault.toBase58(),
    treasury: treasury.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    buyerUsdc: buyerUsdc.toBase58(),
    buyerProperty: buyerProperty.toBase58(),
    pricePerToken: PRICE_PER_TOKEN.toString(),
    totalOffering: TOTAL_OFFERING.toString(),
    purchaseAmount: PURCHASE_AMOUNT.toString(),
    usdcPaid: expectedUsdc.toString(),
    signatures: sigs,
    explorer: {
      program: explorerAddr(PROGRAM_ID),
      offering: explorerAddr(offeringPda),
      settlePurchase: explorer(settleSig),
    },
    verifiedAt: new Date().toISOString(),
  };
  const outPath = join(import.meta.dirname, "devnet-e2e.out.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("-".repeat(72));
  console.log(`Persisted addresses -> ${outPath}`);
  console.log("=".repeat(72));
  console.log(allPass ? "E2E RESULT: SUCCESS ✅" : "E2E RESULT: ASSERTIONS FAILED ❌");
  console.log("=".repeat(72));

  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error("\nE2E FAILED:", err);
  process.exit(1);
});
