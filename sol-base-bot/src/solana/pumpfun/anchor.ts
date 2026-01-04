import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import pumpFunIdl from '../idl/pump_fun_idl.json' with { type: 'json' };
import { PUMP_FUN_PROGRAM, FEE_RECIPIENT } from '../constants.js';

// Load the IDL
const idl = pumpFunIdl as Idl;

/**
 * Creates an Anchor program instance for pump.fun
 */
export function createPumpFunProgram(
  connection: Connection,
  wallet?: Wallet | Keypair
): Program<Idl> {
  // Create a dummy wallet if none provided (for read-only operations)
  let providerWallet: Wallet;
  if (!wallet) {
    providerWallet = new Wallet(Keypair.generate());
  } else if (wallet instanceof Keypair) {
    providerWallet = new Wallet(wallet);
  } else {
    providerWallet = wallet;
  }

  const provider = new AnchorProvider(connection, providerWallet, {
    commitment: 'confirmed',
  });

  return new Program(idl, provider);
}

/**
 * Derives the global PDA
 */
export function deriveGlobalPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global')],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derives the bonding curve PDA
 */
export function deriveBondingCurvePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derives the associated bonding curve token account PDA
 */
export function deriveAssociatedBondingCurvePDA(
  bondingCurve: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') // Associated Token Program
  );
}

/**
 * Derives the creator vault PDA
 */
export function deriveCreatorVaultPDA(creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derives the event authority PDA
 */
export function deriveEventAuthorityPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derives the global volume accumulator PDA
 */
export function deriveGlobalVolumeAccumulatorPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global_volume_accumulator')],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derives the user volume accumulator PDA
 */
export function deriveUserVolumeAccumulatorPDA(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), user.toBuffer()],
    PUMP_FUN_PROGRAM
  );
}

/**
 * Derives the fee config PDA
 */
export function deriveFeeConfigPDA(): [PublicKey, number] {
  const feeProgram = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('fee_config'),
      Buffer.from([
        1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151,
        245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176
      ])
    ],
    feeProgram
  );
}

/**
 * Gets the creator from bonding curve account data
 * This is a placeholder - you'll need to fetch the bonding curve account and parse it
 */
// export async function getBondingCurveCreator(
//   connection: Connection,
//   bondingCurve: PublicKey
// ): Promise<PublicKey | null> {
//   try {
//     const accountInfo = await connection.getAccountInfo(bondingCurve);
//     if (!accountInfo) return null;
    
//     // The creator is typically at a specific offset in the account data
//     // This is a simplified version - you may need to adjust based on actual account layout
//     // For now, we'll try to get it from the coinData API if available
//     return null; // Will be populated from coinData
//   } catch {
//     return null;
//   }
// }

