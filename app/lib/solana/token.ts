import { Buffer } from "node:buffer";
import {
  Commitment,
  Connection,
  PublicKey,
  Signer,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export const MINT_SIZE = 82;
export const TOKEN_ACCOUNT_SIZE = 165;

export enum AccountState {
  Uninitialized = 0,
  Initialized = 1,
  Frozen = 2,
}

export enum AuthorityType {
  MintTokens = 0,
  FreezeAccount = 1,
  AccountOwner = 2,
  CloseAccount = 3,
}

export enum ExtensionType {
  DefaultAccountState = 6,
}

export class TokenAccountNotFoundError extends Error {
  constructor() {
    super("Token account not found");
    this.name = "TokenAccountNotFoundError";
  }
}

export class TokenInvalidAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenInvalidAccountError";
  }
}

export interface TokenAccount {
  address: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  state: AccountState;
  isInitialized: boolean;
  isFrozen: boolean;
}

function encodeU64(value: bigint | number): Buffer {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > (1n << 64n) - 1n) {
    throw new RangeError("token amount must fit in an unsigned 64-bit integer");
  }
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(normalized);
  return data;
}

function encodeCOptionPublicKey(value: PublicKey | null): Buffer {
  const option = Buffer.from([value ? 1 : 0]);
  return Buffer.concat([option, value?.toBuffer() ?? Buffer.alloc(32)]);
}

function authorityKeys(authority: PublicKey, multiSigners: Signer[]) {
  if (multiSigners.length === 0) {
    return [{ pubkey: authority, isSigner: true, isWritable: false }];
  }
  return [
    { pubkey: authority, isSigner: false, isWritable: false },
    ...multiSigners.map((signer) => ({
      pubkey: signer.publicKey,
      isSigner: true,
      isWritable: false,
    })),
  ];
}

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  tokenProgramId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBuffer())) {
    throw new TokenInvalidAccountError("Token account owner is off curve");
  }
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  )[0];
}

export function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: associatedTokenProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export function decodeTokenAccount(
  address: PublicKey,
  data: Buffer | Uint8Array,
): TokenAccount {
  const bytes = Buffer.from(data);
  if (bytes.length < TOKEN_ACCOUNT_SIZE) {
    throw new TokenInvalidAccountError("Invalid token account size");
  }
  const state = bytes.readUInt8(108) as AccountState;
  if (state > AccountState.Frozen) {
    throw new TokenInvalidAccountError("Invalid token account state");
  }
  return {
    address,
    mint: new PublicKey(bytes.subarray(0, 32)),
    owner: new PublicKey(bytes.subarray(32, 64)),
    amount: bytes.readBigUInt64LE(64),
    state,
    isInitialized: state !== AccountState.Uninitialized,
    isFrozen: state === AccountState.Frozen,
  };
}

export async function getTokenAccount(
  connection: Connection,
  address: PublicKey,
  commitment?: Commitment,
  tokenProgramId = TOKEN_PROGRAM_ID,
): Promise<TokenAccount> {
  const info = await connection.getAccountInfo(address, commitment);
  if (!info) throw new TokenAccountNotFoundError();
  if (!info.owner.equals(tokenProgramId)) {
    throw new TokenInvalidAccountError("Token account has an unexpected owner program");
  }
  const account = decodeTokenAccount(address, info.data);
  if (!account.isInitialized) {
    throw new TokenInvalidAccountError("Token account is not initialized");
  }
  return account;
}

export const getAccount = getTokenAccount;

export function createInitializeMint2Instruction(
  mint: PublicKey,
  decimals: number,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  tokenProgramId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("mint decimals must fit in u8");
  }
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.concat([
      Buffer.from([20, decimals]),
      mintAuthority.toBuffer(),
      encodeCOptionPublicKey(freezeAuthority),
    ]),
  });
}

export function createMintToInstruction(
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint | number,
  multiSigners: Signer[] = [],
  tokenProgramId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      ...authorityKeys(authority, multiSigners),
    ],
    data: Buffer.concat([Buffer.from([7]), encodeU64(amount)]),
  });
}

export function createThawAccountInstruction(
  account: PublicKey,
  mint: PublicKey,
  authority: PublicKey,
  multiSigners: Signer[] = [],
  tokenProgramId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      ...authorityKeys(authority, multiSigners),
    ],
    data: Buffer.from([11]),
  });
}

export function createSetAuthorityInstruction(
  account: PublicKey,
  currentAuthority: PublicKey,
  authorityType: AuthorityType,
  newAuthority: PublicKey | null,
  multiSigners: Signer[] = [],
  tokenProgramId = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      ...authorityKeys(currentAuthority, multiSigners),
    ],
    data: Buffer.concat([
      Buffer.from([6, authorityType]),
      encodeCOptionPublicKey(newAuthority),
    ]),
  });
}

export function createInitializeDefaultAccountStateInstruction(
  mint: PublicKey,
  accountState: AccountState,
  tokenProgramId = TOKEN_2022_PROGRAM_ID,
): TransactionInstruction {
  if (!tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new TokenInvalidAccountError(
      "Default account state requires the Token-2022 program",
    );
  }
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.from([28, 0, accountState]),
  });
}

export function getMintLen(extensionTypes: ExtensionType[]): number {
  const unique = [...new Set(extensionTypes)];
  if (
    unique.some((extension) => extension !== ExtensionType.DefaultAccountState)
  ) {
    throw new TokenInvalidAccountError("Unsupported mint extension");
  }
  return unique.length === 0 ? MINT_SIZE : 171;
}

export async function getMinimumBalanceForRentExemptMint(
  connection: Connection,
  commitment?: Commitment,
): Promise<number> {
  return connection.getMinimumBalanceForRentExemption(MINT_SIZE, commitment);
}
