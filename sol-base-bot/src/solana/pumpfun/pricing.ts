import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SimulateTransactionConfig, VersionedTransaction } from '@solana/web3.js';
import { getCoinData } from './api.js';

export interface PumpFunPriceResult {
  solPerToken: number;
  totalSol: number;
  totalUsd: number;
}

// Fee constants
const FEE_BASIS_POINTS = 100n; // 1% fee
const FEE_DENOMINATOR = 10000n;

/**
 * Calculate Pump Fun buy price using the constant product bonding curve formula with fee.
 * 
 * Logic:
 * 1. Read virtual reserves (x, y)
 * 2. Calculate new reserves for target token output (dy)
 *    new_y = y - dy
 *    new_x = k / new_y  (where k = x * y)
 *    dx_needed = new_x - x
 * 3. Add fee to input (Solana fee is on the input amount for buys?)
 *    Actually for PumpFun, the fee is taken from the SOL input.
 *    So effectively: dx_total = dx_needed / (1 - fee_rate)
 * 
 * @param mintStr - The token mint address
 * @param tokenAmount - Amount of tokens to buy
 * @param solPriceUsd - Current SOL price in USD
 * @returns Price information or null if calculation fails
 */
export async function calculatePumpFunBuyPrice(
  mintStr: string,
  tokenAmount: number,
  solPriceUsd: number
): Promise<PumpFunPriceResult | null> {
  try {
    const coinData = await getCoinData(mintStr);
    if (!coinData) return null;

    const vSol = BigInt(coinData['virtual_sol_reserves']);
    const vToken = BigInt(coinData['virtual_token_reserves']);
    const rToken = BigInt(coinData['real_token_reserves']);
    const tokenOut = BigInt(Math.floor(tokenAmount));

    if (vSol <= 0n || vToken <= 0n || tokenOut <= 0n) {
      return null;
    }

    // Check liquidity
    if (tokenOut >= rToken) {
      return null; // Not enough real liquidity
    }

    // Constant product k = x * y
    const k = vSol * vToken;

    // We want to buy 'tokenOut' amount.
    // New virtual token reserves: y_new = y - dy
    const newVToken = vToken - tokenOut;

    if (newVToken <= 0n) {
      return null; // Impossible trade
    }

    // New virtual SOL reserves: x_new = k / y_new
    // We round UP for x_new to ensure we have enough to maintain k
    // x_new = (k + newVToken - 1) / newVToken
    const newVSol = (k + newVToken - 1n) / newVToken;

    // SOL needed (without fee): dx = x_new - x
    const solNeeded = newVSol - vSol;

    if (solNeeded <= 0n) {
      // Should not happen for a buy
      return null;
    }

    // Calculate fee: 1% fee on top of the SOL cost
    // total_sol = sol_needed + fee
    // fee = sol_needed * 1%
    // In pump.fun, typically fee is added to input. 
    // Let's assume standard behavior: User sends SOL, fee is deducted, remaining buys tokens.
    // BUT here we calculating "How much SOL to pay for X tokens".
    // So we need to Provide (solNeeded + fee).

    const fee = (solNeeded * FEE_BASIS_POINTS) / FEE_DENOMINATOR;
    const totalSolLamports = solNeeded + fee;

    const totalSol = Number(totalSolLamports) / LAMPORTS_PER_SOL;
    const solPerToken = totalSol / tokenAmount;
    const totalUsd = totalSol * solPriceUsd;

    if (!Number.isFinite(totalSol) || !Number.isFinite(solPerToken) || !Number.isFinite(totalUsd) || totalSol <= 0) {
      return null;
    }

    return {
      solPerToken: Number(solPerToken.toFixed(18)),
      totalSol: Number(totalSol.toFixed(18)),
      totalUsd
    };
  } catch {
    return null;
  }
}

/**
 * Calculate Pump Fun sell price using the constant product bonding curve formula with fee.
 * 
 * Logic:
 * 1. Read virtual reserves (x, y)
 * 2. Calculate new reserves for input tokens (dy)
 *    new_y = y + dy
 *    new_x = k / new_y
 *    dx_received = x - new_x
 * 3. Deduct fee from output
 * 
 * @param mintStr - The token mint address
 * @param tokenAmount - Amount of tokens to sell
 * @param solPriceUsd - Current SOL price in USD
 * @returns Price information or null if calculation fails
 */
export async function calculatePumpFunSellPrice(
  mintStr: string,
  tokenAmount: number,
  solPriceUsd: number
): Promise<PumpFunPriceResult | null> {
  try {
    const coinData = await getCoinData(mintStr);
    if (!coinData) return null;

    const vSol = BigInt(coinData['virtual_sol_reserves']);
    const vToken = BigInt(coinData['virtual_token_reserves']);
    const rSol = BigInt(coinData['real_sol_reserves']);
    const tokenIn = BigInt(Math.floor(tokenAmount));

    if (vSol <= 0n || vToken <= 0n || tokenIn <= 0n) {
      return null;
    }

    // Constant product k = x * y
    const k = vSol * vToken;

    // New virtual token reserves: y_new = y + dy
    const newVToken = vToken + tokenIn;

    // New virtual SOL reserves: x_new = k / y_new
    // We round UP for x_new to make sure we don't give out too much SOL (conservative)
    // x_new = (k + newVToken - 1) / newVToken
    const newVSol = (k + newVToken - 1n) / newVToken;

    // SOL output (without fee): dx = x - x_new
    const solOutputRaw = vSol - newVSol;

    // Apply fee: 1% deducted from output
    const fee = (solOutputRaw * FEE_BASIS_POINTS) / FEE_DENOMINATOR;
    const solOutputNet = solOutputRaw - fee;

    // Check real reserves - can the bonding curve pay out this much SOL?
    if (solOutputNet > rSol) {
      // Cap at real reserves? Or just return null/fail?
      // For pricing check, let's just return what's possible or null.
      // Usually if real reserves < needed, trade fails. 
      // But real_sol_reserves only accumulates fees/migration liquidity? 
      // NOTE: On pump.fun, 'real_sol_reserves' tracks the SOL available to be grabbed (minus accumulated fees potentially).
      // Actually, standard CPAMM logic implies the SOL is there.
      // Let's check against real_sol_reserves to be safe.
      if (solOutputNet > rSol) {
        // In reality this might mean the curve hasn't graduated yet or something.
        // But we will respect the hard constraint.
        return null;
      }
    }

    const totalSol = Number(solOutputNet) / LAMPORTS_PER_SOL;
    const solPerToken = totalSol / tokenAmount;
    const totalUsd = totalSol * solPriceUsd;

    if (!Number.isFinite(totalSol) || !Number.isFinite(solPerToken) || !Number.isFinite(totalUsd) || totalSol <= 0) {
      return null;
    }

    return {
      solPerToken: Number(solPerToken.toFixed(18)),
      totalSol: Number(totalSol.toFixed(18)),
      totalUsd
    };
  } catch {
    return null;
  }
}

/**
 * Calculate price impact for a trade size on Pump.fun bonding curve.
 */
export async function calculatePriceImpact(
  mintStr: string,
  tokenAmount: bigint,
  isBuy: boolean
): Promise<number | null> {
  try {
    const coinData = await getCoinData(mintStr);
    if (!coinData) return null;

    const vSol = BigInt(coinData['virtual_sol_reserves']);
    const vToken = BigInt(coinData['virtual_token_reserves']);

    if (vSol <= 0n || vToken <= 0n || tokenAmount <= 0n) {
      return null;
    }

    // Spot Price = vSol / vToken
    const currentPrice = Number(vSol) / Number(vToken);

    // Constant product k
    const k = vSol * vToken;

    let newVToken: bigint;
    let newVSol: bigint;

    if (isBuy) {
      newVToken = vToken - tokenAmount;
      if (newVToken <= 0n) return null;
      newVSol = (k + newVToken - 1n) / newVToken; // Round up
    } else {
      newVToken = vToken + tokenAmount;
      newVSol = k / newVToken; // Round down (standard integer division) is fine for estimation
    }

    // New Price = newVSol / newVToken
    const newPrice = Number(newVSol) / Number(newVToken);

    const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;

    if (!Number.isFinite(priceImpact)) return null;

    return Number(priceImpact.toFixed(6));
  } catch (error) {
    console.error('Error calculating price impact:', error);
    return null;
  }
}


