import { Program } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Connection, PublicKey, Keypair, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import {
  deriveGlobalPDA,
  deriveBondingCurvePDA,
  deriveAssociatedBondingCurvePDA,
  deriveCreatorVaultPDA,
  deriveEventAuthorityPDA,
  deriveGlobalVolumeAccumulatorPDA,
  deriveUserVolumeAccumulatorPDA,
  deriveFeeConfigPDA,
} from './anchor.js';
import { FEE_RECIPIENT, PUMP_FUN_PROGRAM } from '../constants.js';

const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');

/**
 * Fetches the creator from bonding curve account using Anchor's account decoder
 * This ensures we use the same decoding method that Anchor uses for auto-derivation
 */
export async function getBondingCurveCreator(
  program: Program<Idl>,
  connection: Connection,
  bondingCurve: PublicKey
): Promise<PublicKey | null> {
  try {
    // Use Anchor's account decoder to decode the BondingCurve account
    // This ensures we use the same method Anchor uses for auto-derivation
    const bondingCurveAccount = await (program.account as any).bondingCurve.fetch(bondingCurve);
    
    if (!bondingCurveAccount.creator) {
      console.warn('Bonding curve account has no creator');
      return null;
    }
    
    // Verify it's not a zero address
    if (bondingCurveAccount.creator.equals(PublicKey.default)) {
      console.warn('Creator is zero address');
      return null;
    }
    
    return bondingCurveAccount.creator;
  } catch (error) {
    console.error('Error decoding bonding curve account with Anchor:', error);
    return null;
  }
}

/**
 * Builds a buy instruction using Anchor SDK
 */
export async function buildBuyInstruction(
  program: Program<Idl>,
  connection: Connection,
  mint: PublicKey,
  user: PublicKey,
  tokenOut: bigint,
  maxSolCost: bigint,
  trackVolume: boolean = false
): Promise<TransactionInstruction> {
  const [global] = deriveGlobalPDA();
  const [bondingCurve] = deriveBondingCurvePDA(mint);
  const [associatedBondingCurve] = deriveAssociatedBondingCurvePDA(bondingCurve, mint);
  const associatedUser = await getAssociatedTokenAddress(mint, user, false);
  const [eventAuthority] = deriveEventAuthorityPDA();
  const [globalVolumeAccumulator] = deriveGlobalVolumeAccumulatorPDA();
  const [userVolumeAccumulator] = deriveUserVolumeAccumulatorPDA(user);
  const [feeConfig] = deriveFeeConfigPDA();

  // Get creator from bonding curve and derive creatorVault PDA
  const creator = await getBondingCurveCreator(program, connection, bondingCurve);
  if (!creator) {
    throw new Error('Failed to get bonding curve creator');
  }
  const [creatorVault] = deriveCreatorVaultPDA(creator);

  const instruction = await program.methods
    .buy(
      new BN(tokenOut.toString()),
      new BN(maxSolCost.toString()),
      { some: trackVolume } // OptionBool: { some: true } or { none: null }
    )
    .accounts({
      global,
      feeRecipient: FEE_RECIPIENT,
      mint,
      bondingCurve,
      associatedBondingCurve,
      associatedUser,
      user,
      systemProgram: new PublicKey('11111111111111111111111111111111'),
      tokenProgram: TOKEN_PROGRAM_ID,
      creatorVault,
      eventAuthority,
      program: PUMP_FUN_PROGRAM,
      globalVolumeAccumulator,
      userVolumeAccumulator,
      feeConfig,
      feeProgram: FEE_PROGRAM,
    })
    .instruction();
  
  return instruction;
}

/**
 * Builds a sell instruction using Anchor SDK
 */
export async function buildSellInstruction(
  program: Program<Idl>,
  connection: Connection,
  mint: PublicKey,
  user: PublicKey,
  tokenIn: bigint,
  minSolOutput: bigint
): Promise<TransactionInstruction> {
  const [global] = deriveGlobalPDA();
  const [bondingCurve] = deriveBondingCurvePDA(mint);
  const [associatedBondingCurve] = deriveAssociatedBondingCurvePDA(bondingCurve, mint);
  const associatedUser = await getAssociatedTokenAddress(mint, user, false);
  const [eventAuthority] = deriveEventAuthorityPDA();
  const [feeConfig] = deriveFeeConfigPDA();

  // Get creator from bonding curve and derive creatorVault PDA
  const creator = await getBondingCurveCreator(program, connection, bondingCurve);
  if (!creator) {
    throw new Error('Failed to get bonding curve creator');
  }
  const [creatorVault] = deriveCreatorVaultPDA(creator);

  const instruction = await program.methods
    .sell(
      new BN(tokenIn.toString()),
      new BN(minSolOutput.toString())
    )
    .accounts({
      global,
      feeRecipient: FEE_RECIPIENT,
      mint,
      bondingCurve,
      associatedBondingCurve,
      associatedUser,
      user,
      systemProgram: new PublicKey('11111111111111111111111111111111'),
      creatorVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      eventAuthority,
      program: PUMP_FUN_PROGRAM,
      feeConfig,
      feeProgram: FEE_PROGRAM,
    })
    .instruction();
  
  return instruction;
}

