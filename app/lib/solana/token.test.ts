// @vitest-environment node

import { Buffer } from "node:buffer";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountState,
  AuthorityType,
  ExtensionType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TokenInvalidAccountError,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeDefaultAccountStateInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createThawAccountInstruction,
  decodeTokenAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "./token";

function key(byte: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(byte));
}

describe("safe SPL Token wire helpers", () => {
  it("derives canonical classic and Token-2022 associated accounts", () => {
    const owner = key(1);
    const mint = key(2);

    expect(
      getAssociatedTokenAddressSync(
        mint,
        owner,
        true,
        TOKEN_PROGRAM_ID,
      ).toBase58(),
    ).toBe("CsYkfSfTUTWwnoeRkGchtai5kkYz2SC33kKJwA99wVr3");
    expect(
      getAssociatedTokenAddressSync(
        mint,
        owner,
        true,
        TOKEN_2022_PROGRAM_ID,
      ).toBase58(),
    ).toBe("DyaUQ3JTcmWApDibKtBvxLBhUPjvA4KEM99t45qz3bfh");
  });

  it("builds the canonical idempotent ATA instruction", () => {
    const payer = key(3);
    const owner = key(4);
    const mint = key(5);
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    const instruction = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      owner,
      mint,
    );

    expect(instruction.programId).toEqual(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(Array.from(instruction.data)).toEqual([1]);
    expect(instruction.keys).toEqual([
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
  });

  it("decodes amount, mint, owner, and frozen state from the base layout", () => {
    const address = key(6);
    const mint = key(7);
    const owner = key(8);
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0);
    owner.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(9_007_199_254_740_993n, 64);
    data.writeUInt8(AccountState.Frozen, 108);

    expect(decodeTokenAccount(address, data)).toEqual({
      address,
      mint,
      owner,
      amount: 9_007_199_254_740_993n,
      state: AccountState.Frozen,
      isInitialized: true,
      isFrozen: true,
    });
    expect(() => decodeTokenAccount(address, Buffer.alloc(164))).toThrow(
      TokenInvalidAccountError,
    );
  });

  it("encodes mint, mint-to, thaw, and authority instructions exactly", () => {
    const mint = key(9);
    const authority = key(10);
    const destination = key(11);
    const nextAuthority = key(12);

    const initialize = createInitializeMint2Instruction(
      mint,
      6,
      authority,
      nextAuthority,
    );
    expect(initialize.data.length).toBe(67);
    expect(Array.from(initialize.data.subarray(0, 2))).toEqual([20, 6]);
    expect(initialize.data.subarray(2, 34)).toEqual(authority.toBuffer());
    expect(initialize.data.readUInt8(34)).toBe(1);
    expect(initialize.data.subarray(35)).toEqual(nextAuthority.toBuffer());

    const initializeWithoutFreezeAuthority = createInitializeMint2Instruction(
      mint,
      6,
      authority,
      null,
    );
    expect(initializeWithoutFreezeAuthority.data.length).toBe(67);
    expect(initializeWithoutFreezeAuthority.data.readUInt8(34)).toBe(0);
    expect(initializeWithoutFreezeAuthority.data.subarray(35)).toEqual(Buffer.alloc(32));

    const mintTo = createMintToInstruction(
      mint,
      destination,
      authority,
      42n,
    );
    expect(Array.from(mintTo.data)).toEqual([7, 42, 0, 0, 0, 0, 0, 0, 0]);
    expect(createThawAccountInstruction(destination, mint, authority).data).toEqual(
      Buffer.from([11]),
    );

    const setAuthority = createSetAuthorityInstruction(
      mint,
      authority,
      AuthorityType.FreezeAccount,
      nextAuthority,
    );
    expect(Array.from(setAuthority.data.subarray(0, 2))).toEqual([6, 1]);
    expect(setAuthority.data.readUInt8(2)).toBe(1);
    expect(setAuthority.data.subarray(3)).toEqual(nextAuthority.toBuffer());

    const revokeAuthority = createSetAuthorityInstruction(
      mint,
      authority,
      AuthorityType.MintTokens,
      null,
    );
    expect(revokeAuthority.data.length).toBe(35);
    expect(revokeAuthority.data.readUInt8(2)).toBe(0);
    expect(revokeAuthority.data.subarray(3)).toEqual(Buffer.alloc(32));
  });

  it("encodes frozen-by-default Token-2022 setup and exact mint lengths", () => {
    const mint = key(13);
    const instruction = createInitializeDefaultAccountStateInstruction(
      mint,
      AccountState.Frozen,
    );

    expect(instruction.programId).toEqual(TOKEN_2022_PROGRAM_ID);
    expect(instruction.data).toEqual(Buffer.from([28, 0, 2]));
    expect(getMintLen([])).toBe(MINT_SIZE);
    expect(getMintLen([ExtensionType.DefaultAccountState])).toBe(171);
  });
});
