import { JsonRpcProvider } from 'ethers';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getTokenDecimals } from '../base/uniswap/router.js';
import { getPriceFetcher } from '../utils/priceFetcher.js';
import type { MarketStats } from './marketFetcher.js';
import type { WalletStats } from './walletStats.js';
import type { Opportunity, TradeSize } from './types.js';

// Fee constants
const PUMPFUN_FEE_BPS = 100n; // 1%
const UNISWAP_FEE_BPS = 30n;  // 0.3%
const BPS_DENOMINATOR = 10000n;

/**
 * Calculate marginal price on PumpFun (AMM) for a given input of tokens.
 * This is effectively the price at that specific bonding curve point.
 * P = virtual_sol / virtual_tokens
 */
function getPumpFunMarginalPrice(
  virtualSol: bigint,
  virtualTokens: bigint,
  amountInTokens: bigint,
  isBuyOnInternal: boolean // Buy on PumpFun means we put SOL in, take Tokens out.
): number {
  // Constant product k = x * y
  // For marginal price, we can just use current reserves ratio if amount is small, 
  // but for proper equilibrium search we should use the reserves *after* the trade (or average execution price).
  // However, "Marginal Price" usually means spot price *after* the trade is executed (the final price).

  let finalVSol = virtualSol;
  let finalVToken = virtualTokens;

  // We are solving for trade size 'x' (tokens).
  // If we BUY on PumpFun (SOL in -> Tokens out):
  //   Tokens removed = amountInTokens
  //   New VToken = VToken - amountInTokens
  //   New VSol = k / New VToken

  // If we SELL on PumpFun (Tokens in -> SOL out):
  //   Tokens added = amountInTokens
  //   New VToken = VToken + amountInTokens
  //   New VSol = k / New VToken

  const k = virtualSol * virtualTokens;

  if (isBuyOnInternal) {
    if (amountInTokens >= virtualTokens) return Infinity; // Impossible
    finalVToken = virtualTokens - amountInTokens;
  } else {
    finalVToken = virtualTokens + amountInTokens;
  }

  // Avoid division by zero
  if (finalVToken <= 0n) return Infinity;

  finalVSol = k / finalVToken;

  // Spot Price = Sol / Token
  const price = Number(finalVSol) / Number(finalVToken);

  // Adjust for fee?
  // Marginal price viewed by the trader includes the impact of fees.
  // If buying, price is higher (you pay fee). Effective Price = SpotPrice / (1 - fee) ?
  // Actually, price impact + fee.
  // Let's stick to pure AMM Spot Price for equilibrium, and handle fee in the "effective price" seen by arb.
  // Effective Price = (SOL Out / Token In) or (SOL In / Token Out).

  return price;
}

/**
 * Calculate effective price for a specific trade size on PumpFun.
 * Returns SOL/Token.
 */
function getPumpFunEffectivePrice(
  virtualSol: bigint,
  virtualTokens: bigint,
  amountTokens: bigint,
  isBuy: boolean // Buy = Buying Tokens (SOL In)
): number {
  if (amountTokens <= 0n) return 0;

  const k = virtualSol * virtualTokens;
  let solAmount: bigint;

  if (isBuy) {
    // Buy Tokens: Tokens Out = amountTokens
    // new_y = y - amountTokens
    // new_x = k / new_y
    // dx = new_x - x
    // fee = dx * 1% ? No, typically input fee. 
    // We need to Provide SOL = (dx + fee).

    const newVToken = virtualTokens - amountTokens;
    if (newVToken <= 0n) return Infinity;

    const newVSol = (k + newVToken - 1n) / newVToken;
    const solNeeded = newVSol - virtualSol;

    // Fee calculation: SOL In * (1 - fee) = solNeeded  => SOL In = solNeeded / (1 - fee) ???
    // Or is fee added on top? 
    // Based on previous logic: Fee is calculated on solNeeded (if taken from input).
    // Let's assume standard: totalSol = solNeeded + (solNeeded * 100 / 10000)
    const fee = (solNeeded * PUMPFUN_FEE_BPS) / BPS_DENOMINATOR;
    solAmount = solNeeded + fee;

  } else {
    // Sell Tokens: Tokens In = amountTokens
    // new_y = y + amountTokens
    // new_x = k / new_y
    // dx = x - new_x
    // fee = dx * 1%
    // Net SOL = dx - fee

    const newVToken = virtualTokens + amountTokens;
    const newVSol = (k + newVToken - 1n) / newVToken; // Safe approximation
    const solOutputRaw = virtualSol - newVSol;

    const fee = (solOutputRaw * PUMPFUN_FEE_BPS) / BPS_DENOMINATOR;
    solAmount = solOutputRaw - fee;
  }

  return Number(solAmount) / Number(amountTokens); // Returns SOL per Token (raw units ratio)
}

/**
 * Calculate marginal price on Uniswap V2 (Base).
 * P = usdc_res / token_res (after trade impact)
 */
function getUniswapV2MarginalPrice(
  usdcReserves: bigint,
  tokenReserves: bigint,
  amountTokens: bigint,
  isBuy: boolean // Buy = Buy Tokens (USDC In, Tokens Out)
): number {
  const k = usdcReserves * tokenReserves;
  let newUsdcRes: bigint;
  let newTokenRes: bigint;

  if (isBuy) {
    // Buy Tokens: Tokens Out.
    if (amountTokens >= tokenReserves) return Infinity;
    newTokenRes = tokenReserves - amountTokens;
  } else {
    // Sell Tokens: Tokens In.
    newTokenRes = tokenReserves + amountTokens;
  }

  // new_usdc = k / new_token
  newUsdcRes = k / newTokenRes;

  // Price = USDC / Token
  return Number(newUsdcRes) / Number(newTokenRes);
}

/**
 * Calculate effective price for a specific trade size on Uniswap V2 (Base).
 * Returns USDC/Token (which is roughly equivalent to USD assuming USDC peg).
 */
function getUniswapV2EffectivePrice(
  usdcReserves: bigint,
  tokenReserves: bigint,
  amountTokens: bigint,
  isBuy: boolean // Buy = Buy Tokens (USDC In)
): number {
  if (amountTokens <= 0n) return 0;
  const k = usdcReserves * tokenReserves;

  let usdcAmount: bigint;

  if (isBuy) {
    // Buy Tokens: Tokens Out = amountTokens
    // new_token_res = token_res - amountTokens
    // new_usdc_res = k / new_token_res
    // usdc_needed = new_usdc_res - usdc_res
    // Uniswap V2 fee is usually on input.
    // amountInWithFee * 997 = numerator... 
    // Here we just want "How much USDC to Pay".
    // required_amount_in = (numerator * 1000) / 997

    const newTokenReserves = tokenReserves - amountTokens;
    if (newTokenReserves <= 0n) return Infinity;

    const newUsdcReserves = (k + newTokenReserves - 1n) / newTokenReserves;
    const usdcNeededNoFee = newUsdcReserves - usdcReserves;

    // Adjust for 0.3% fee: Input = Output / 0.997
    // usdcAmount = (usdcNeededNoFee * 10000) / 9970
    usdcAmount = (usdcNeededNoFee * 10000n) / (10000n - UNISWAP_FEE_BPS);

  } else {
    // Sell Tokens: Tokens In = amountTokens
    // amountInWithFee = amountTokens * 997 / 1000
    // new_token_res = token_res + amountInWithFee
    // ... Wait, standard x*y=k uses virtual balances for fee? 
    // Standard Uniswap V2:
    // Input amountIn.
    // amountInWithFee = amountIn * 997
    // numerator = amountInWithFee * reserveOut
    // denominator = (reserveIn * 1000) + amountInWithFee
    // amountOut = numerator / denominator

    // Here we know amountTokens (Input).
    const amountInWithFee = amountTokens * (10000n - UNISWAP_FEE_BPS);
    const numerator = amountInWithFee * usdcReserves;
    const denominator = (tokenReserves * 10000n) + amountInWithFee;
    usdcAmount = numerator / denominator;
  }

  return Number(usdcAmount) / Number(amountTokens);
}


/**
 * Calculate the post-arbitrage state for both chains after executing trades.
 * This accounts for the COMBINED effect of buying on one chain and selling on the other.
 */
function calculatePostArbitrageState(
  solanaReserves: { vSol: bigint; vToken: bigint },
  baseReserves: { usdc: bigint; token: bigint; usdcDecimals: number },
  tradeSize: bigint,
  direction: 'SOLANA_TO_BASE' | 'BASE_TO_SOLANA',
  solDecimals: number,
  baseDecimals: number,
  solPriceUsd: number
): {
  solana: { priceSolPerToken: number; priceUsd: number };
  base: { priceUsdcPerToken: number; priceUsd: number };
} {
  const k_sol = solanaReserves.vSol * solanaReserves.vToken;
  const k_base = baseReserves.usdc * baseReserves.token;

  let newSolVToken: bigint;
  let newSolVSol: bigint;
  let newBaseToken: bigint;
  let newBaseUsdc: bigint;

  if (direction === 'SOLANA_TO_BASE') {
    // Buy on Solana: tokens OUT, SOL IN
    if (tradeSize >= solanaReserves.vToken) {
      return {
        solana: { priceSolPerToken: Infinity, priceUsd: Infinity },
        base: { priceUsdcPerToken: Infinity, priceUsd: Infinity },
      };
    }
    newSolVToken = solanaReserves.vToken - tradeSize;
    if (newSolVToken <= 0n) {
      return {
        solana: { priceSolPerToken: Infinity, priceUsd: Infinity },
        base: { priceUsdcPerToken: Infinity, priceUsd: Infinity },
      };
    }
    newSolVSol = (k_sol + newSolVToken - 1n) / newSolVToken;

    // Sell on Base: tokens IN, USDC OUT
    const tradeSizeBase = (tradeSize * (10n ** BigInt(baseDecimals))) / (10n ** BigInt(solDecimals));
    newBaseToken = baseReserves.token + tradeSizeBase;
    newBaseUsdc = k_base / newBaseToken;

  } else {
    // Buy on Base: tokens OUT, USDC IN
    const tradeSizeBase = (tradeSize * (10n ** BigInt(baseDecimals))) / (10n ** BigInt(solDecimals));
    if (tradeSizeBase >= baseReserves.token) {
      return {
        solana: { priceSolPerToken: Infinity, priceUsd: Infinity },
        base: { priceUsdcPerToken: Infinity, priceUsd: Infinity },
      };
    }
    newBaseToken = baseReserves.token - tradeSizeBase;
    if (newBaseToken <= 0n) {
      return {
        solana: { priceSolPerToken: Infinity, priceUsd: Infinity },
        base: { priceUsdcPerToken: Infinity, priceUsd: Infinity },
      };
    }
    newBaseUsdc = (k_base + newBaseToken - 1n) / newBaseToken;

    // Sell on Solana: tokens IN, SOL OUT
    newSolVToken = solanaReserves.vToken + tradeSize;
    newSolVSol = k_sol / newSolVToken;
  }

  // Calculate marginal prices (spot prices after trade)
  // Solana: (lamports / token_raw_units)
  const priceSolNative = Number(newSolVSol) / Number(newSolVToken);
  // Convert to USD: normalize decimals and multiply by SOL price
  // Convert: (lamports/raw_token) × (SOL/lamport) × (USD/SOL) × (raw_token/token)
  //         = (lamports/raw_token) × (1/10^9) × solPriceUsd × (10^solDecimals)
  const priceSolUsd = (priceSolNative * solPriceUsd * (10 ** solDecimals)) / 1e9;

  // Base: (raw_usdc / raw_token)
  const priceBaseNative = Number(newBaseUsdc) / Number(newBaseToken);
  // Convert to USD: normalize decimals
  // Convert: (raw_usdc/raw_token) × (USDC/raw_usdc) × (raw_token/token)
  //         = (raw_usdc/raw_token) × (1/10^usdcDec) × (10^baseDec)
  const priceBaseUsd = (priceBaseNative * (10 ** baseDecimals)) / (10 ** baseReserves.usdcDecimals);

  return {
    solana: { priceSolPerToken: priceSolNative, priceUsd: priceSolUsd },
    base: { priceUsdcPerToken: priceBaseNative, priceUsd: priceBaseUsd },
  };
}

/**
 * Find equilibrium trade size that brings both markets to the same price.
 * 
 * For true equilibrium:
 * - After buying X tokens on Solana (price increases)
 * - And selling X tokens on Base (price decreases)
 * - The marginal prices on both chains should be equal
 * 
 * This uses binary search to find where: marginal_price_solana = marginal_price_base
 */
function findEquilibriumTradeSize(
  config: {
    SOLANA_SOL_PRICE_USD: number,
    TRADE_SIZE_USD: number,
  },
  marketStats: MarketStats,
  direction: 'SOLANA_TO_BASE' | 'BASE_TO_SOLANA'
): bigint {
  const solDecimals = marketStats.solana.tokenDecimals;
  const baseDecimals = marketStats.base.tokenDecimals;

  // Determine max trade constraints
  const maxTradeSizeUsd = config.TRADE_SIZE_USD;

  // Calculate max tokens based on reserves (increase to 80% to allow equilibrium to be reached)
  const maxTokensPumpFun = (marketStats.solana.virtualTokenReserves * 80n) / 100n;
  const maxTokensBase = (marketStats.base.tokenReserves * 80n) / 100n;

  // Normalize to same decimals for comparison
  const maxTokensBaseInSolDec = (maxTokensBase * (10n ** BigInt(solDecimals))) / (10n ** BigInt(baseDecimals));

  // Use the smaller of the two limits
  let high = maxTokensPumpFun < maxTokensBaseInSolDec ? maxTokensPumpFun : maxTokensBaseInSolDec;

  // Also cap by max trade size USD
  const avgPriceUsd = (marketStats.solana.priceUsd + marketStats.base.priceUsd) / 2;
  const maxTokensByUsd = BigInt(Math.floor((maxTradeSizeUsd / avgPriceUsd) * (10 ** solDecimals)));
  if (maxTokensByUsd < high) {
    high = maxTokensByUsd;
  }

  let low = 0n;
  let optimalSize = 0n;
  let bestPriceDiff = Infinity;
  const iterations = 200; // Increased for better precision
  const tolerance = 0.001; // Tightened to 0.001% (was 0.01%)

  console.log(`[EQUILIBRIUM] ========================================`);
  console.log(`[EQUILIBRIUM] Starting equilibrium search`);
  console.log(`[EQUILIBRIUM] Direction: ${direction}`);
  console.log(`[EQUILIBRIUM] Search range: 0 to ${high} (${(Number(high) / (10 ** solDecimals)).toFixed(2)} tokens)`);
  console.log(`[EQUILIBRIUM] Initial Solana: $${marketStats.solana.priceUsd.toFixed(8)} (${Number(marketStats.solana.virtualSolReserves) / 1e9} SOL, ${Number(marketStats.solana.virtualTokenReserves) / (10 ** solDecimals)} tokens)`);
  console.log(`[EQUILIBRIUM] Initial Base: $${marketStats.base.priceUsd.toFixed(8)} (${Number(marketStats.base.usdcReserves) / 1e6} USDC, ${Number(marketStats.base.tokenReserves) / (10 ** baseDecimals)} tokens)`);
  console.log(`[EQUILIBRIUM] ========================================`);
  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2n;
    if (mid <= 0n) {
      low = 1n;
      continue;
    }

    // Use the new combined state calculator
    const postState = calculatePostArbitrageState(
      {
        vSol: marketStats.solana.virtualSolReserves,
        vToken: marketStats.solana.virtualTokenReserves,
      },
      {
        usdc: marketStats.base.usdcReserves,
        token: marketStats.base.tokenReserves,
        usdcDecimals: marketStats.base.usdcDecimals,
      },
      mid,
      direction,
      solDecimals,
      baseDecimals,
      config.SOLANA_SOL_PRICE_USD
    );

    const priceSolUsd = postState.solana.priceUsd;
    const priceBaseUsd = postState.base.priceUsd;

    // Check for invalid prices
    if (!Number.isFinite(priceSolUsd) || !Number.isFinite(priceBaseUsd)) {
      // Trade size too large, reduce high
      high = mid - 1n;
      continue;
    }

    // Calculate price difference after this trade
    const priceDiff = Math.abs(priceSolUsd - priceBaseUsd);
    const avgPrice = (priceSolUsd + priceBaseUsd) / 2;
    const priceDiffPercent = (priceDiff / avgPrice) * 100;

    // Track the best solution found
    if (priceDiff < bestPriceDiff) {
      bestPriceDiff = priceDiff;
      optimalSize = mid;
    }

    // Debug logging every 10 iterations
    if (i % 10 === 0) {
      console.log(`[EQUILIBRIUM] Iteration ${i}: size=${mid}, solPrice=$${priceSolUsd.toFixed(8)}, basePrice=$${priceBaseUsd.toFixed(8)}, diff=${priceDiffPercent.toFixed(4)}%`);
    }

    // Check if we've found equilibrium within tolerance
    if (priceDiffPercent < tolerance) {
      console.log(`[EQUILIBRIUM] ✓ Found equilibrium at iteration ${i}: size=${mid}, price diff=${priceDiffPercent.toFixed(6)}%`);
      console.log(`[EQUILIBRIUM] ✓ Final prices - Solana: $${priceSolUsd.toFixed(8)}, Base: $${priceBaseUsd.toFixed(8)}`);
      return mid;
    }

    // Binary search logic:
    // If we're buying on Solana and selling on Base:
    //   - As size increases, Solana price goes UP, Base price goes DOWN
    //   - If Solana price < Base price, we need to trade MORE
    //   - If Solana price > Base price, we've traded TOO MUCH
    // If we're buying on Base and selling on Solana:
    //   - As size increases, Base price goes UP, Solana price goes DOWN
    //   - If Base price < Solana price, we need to trade MORE
    //   - If Base price > Solana price, we've traded TOO MUCH

    if (direction === 'SOLANA_TO_BASE') {
      // Buy Solana -> Sell Base
      if (priceSolUsd < priceBaseUsd) {
        // Solana still cheaper, can trade more
        low = mid + 1n;
      } else {
        // Traded too much, prices crossed over
        high = mid - 1n;
      }
    } else {
      // Buy Base -> Sell Solana
      if (priceBaseUsd < priceSolUsd) {
        // Base still cheaper, can trade more
        low = mid + 1n;
      } else {
        // Traded too much, prices crossed over
        high = mid - 1n;
      }
    }
  }

  console.log(`[EQUILIBRIUM] ⚠ Max iterations reached. Best size found: ${optimalSize}, final price diff: $${bestPriceDiff.toFixed(8)} (${((bestPriceDiff / avgPriceUsd) * 100).toFixed(4)}%)`);

  // Validate the best solution
  if (optimalSize > 0n) {
    const finalState = calculatePostArbitrageState(
      {
        vSol: marketStats.solana.virtualSolReserves,
        vToken: marketStats.solana.virtualTokenReserves,
      },
      {
        usdc: marketStats.base.usdcReserves,
        token: marketStats.base.tokenReserves,
        usdcDecimals: marketStats.base.usdcDecimals,
      },
      optimalSize,
      direction,
      solDecimals,
      baseDecimals,
      config.SOLANA_SOL_PRICE_USD
    );
    console.log(`[EQUILIBRIUM] Final validation - Solana: $${finalState.solana.priceUsd.toFixed(8)}, Base: $${finalState.base.priceUsd.toFixed(8)}`);
  }

  return optimalSize > 0n ? optimalSize : 0n;
}


/**
 * Analyze arbitrage opportunity
 */
export async function analyzeOpportunity(
  config: {
    MIN_PROFIT_THRESHOLD: number;
    TRADE_SIZE_USD: number;
    SOLANA_SOL_PRICE_USD: number;
    BASE_TOKEN_ADDRESS: string;
    BASE_USDC_ADDRESS: string;
    COINMARKETCAP_API_KEY: string;
  },
  marketStats: MarketStats,
  walletStats: WalletStats | null,
  baseProvider: JsonRpcProvider
): Promise<Opportunity | null> {
  // Initial check: is there any spread at zero volume?
  const priceDiffUsd = marketStats.base.priceUsd - marketStats.solana.priceUsd;
  const priceDiffPercent = (priceDiffUsd / marketStats.solana.priceUsd) * 100;

  // Determines flow direction
  const direction = priceDiffPercent > 0 ? 'SOLANA_TO_BASE' : 'BASE_TO_SOLANA';

  // Quick threshold check on spot prices
  if (Math.abs(priceDiffPercent) < config.MIN_PROFIT_THRESHOLD * 100) {
    return null;
  }

  // Get SOL price
  let solPriceUsd = config.SOLANA_SOL_PRICE_USD;
  // (Optional: fetch real price if needed, but for tight loop config is faster)

  // Find Optimal Trade Size
  const solanaTokenAmount = findEquilibriumTradeSize(
    { SOLANA_SOL_PRICE_USD: solPriceUsd, TRADE_SIZE_USD: config.TRADE_SIZE_USD },
    marketStats,
    direction
  );

  if (solanaTokenAmount <= 0n) {
    return null;
  }

  // Calculate final amounts based on the optimal token amount
  const solDecimals = marketStats.solana.tokenDecimals;
  const baseDecimals = marketStats.base.tokenDecimals;

  // Convert token amount to Base decimals
  const baseTokenAmount = (solanaTokenAmount * (10n ** BigInt(baseDecimals))) / (10n ** BigInt(solDecimals));

  let solanaSolAmount: number;
  let baseUsdcAmount: number;

  if (direction === 'SOLANA_TO_BASE') {
    // Buy Sol -> Sell Base
    // Calculate SOL Cost
    const priceRaw = getPumpFunEffectivePrice(marketStats.solana.virtualSolReserves, marketStats.solana.virtualTokenReserves, solanaTokenAmount, true);
    const solCostRaw = priceRaw * Number(solanaTokenAmount);
    solanaSolAmount = solCostRaw / LAMPORTS_PER_SOL; // Rough Estimate from raw units
    // Re-calculate accurately:
    // We can just use the internal helper logic again or trust the raw ratio.
    // Raw Ratio = (RawSOL / RawToken). SolCost = Ratio * RawToken = RawSOL.
    // So solCostRaw IS valid if we interpret it as SOL Lamports? 
    // getPumpFunEffectivePrice returns (Lamports / TokenUnits).
    // So priceRaw * tokenAmount = Lamports.
    // Wait, getPumpFunEffectivePrice inputs are BigInts, returns Number.
    // Let's recalculate precisely using the helper logic if possible, or just use the number.
    // For the opportunity object, Number precision is okay.
    solanaSolAmount = (priceRaw * Number(solanaTokenAmount)) / 1e9;

    // Calculate USDC Revenue
    const priceBaseRaw = getUniswapV2EffectivePrice(marketStats.base.usdcReserves, marketStats.base.tokenReserves, baseTokenAmount, false);
    // PriceBaseRaw = RawUSDC / RawToken
    const usdcRevenueRaw = priceBaseRaw * Number(baseTokenAmount);
    baseUsdcAmount = usdcRevenueRaw / (10 ** marketStats.base.usdcDecimals);

  } else {
    // Buy Base -> Sell Solana
    // Calculate USDC Cost
    const priceBaseRaw = getUniswapV2EffectivePrice(marketStats.base.usdcReserves, marketStats.base.tokenReserves, baseTokenAmount, true);
    const usdcCostRaw = priceBaseRaw * Number(baseTokenAmount);
    baseUsdcAmount = usdcCostRaw / (10 ** marketStats.base.usdcDecimals);

    // Calculate SOL Revenue
    const priceSolRaw = getPumpFunEffectivePrice(marketStats.solana.virtualSolReserves, marketStats.solana.virtualTokenReserves, solanaTokenAmount, false);
    const solRevenueRaw = priceSolRaw * Number(solanaTokenAmount);
    solanaSolAmount = solRevenueRaw / 1e9;
  }

  // Verify wallet balances (if provided)
  // Logic: clamp amounts to wallet balances
  // For now, let's just return the opportunity and let the executor handle insufficient funds or clamp there.
  // ... or we can clamp the 'maxTokens' in binary search using wallet balances. 
  // (Left as future optimization, currently strictly analyzing arbs)

  const tradeSize: TradeSize = {
    solana: {
      tokenAmount: solanaTokenAmount,
      solAmount: solanaSolAmount,
    },
    base: {
      tokenAmount: baseTokenAmount,
      usdcAmount: baseUsdcAmount,
    },
  };

  // Estimate Profit
  // Profit = Revenue - Cost
  // We need to convert everything to USD
  let profitUsd = 0;
  if (direction === 'SOLANA_TO_BASE') {
    const costUsd = solanaSolAmount * solPriceUsd;
    const revUsd = baseUsdcAmount; // USDC = 1 USD
    profitUsd = revUsd - costUsd;
  } else {
    const costUsd = baseUsdcAmount;
    const revUsd = solanaSolAmount * solPriceUsd;
    profitUsd = revUsd - costUsd;
  }

  // Check min profit threshold one last time with real values
  const totalVolumeUsd = (direction === 'SOLANA_TO_BASE') ? (solanaSolAmount * solPriceUsd) : baseUsdcAmount;
  const profitPercent = (profitUsd / totalVolumeUsd) * 100;

  if (profitPercent < config.MIN_PROFIT_THRESHOLD * 100) {
    return null;
  }

  const opportunity: Opportunity = {
    id: `opp_${Date.now()}`,
    detectedAt: Date.now(),
    solanaPrice: {
      price: marketStats.solana.priceUsd,
      timestamp: Date.now(),
      source: 'api',
      chain: 'solana',
    },
    basePrice: {
      price: marketStats.base.priceUsd,
      timestamp: Date.now(),
      source: 'api',
      chain: 'base',
    },
    priceDifferencePercent: Math.abs(priceDiffPercent), // Spot price diff
    direction,
    optimalTradeSize: tradeSize,
    estimatedProfitUsd: profitUsd,
    estimatedProfitPercent: profitPercent, // Realized profit percent
    liquidity: {
      solana: {
        solReserves: marketStats.solana.realSolReserves,
        tokenReserves: marketStats.solana.realTokenReserves,
        virtualSolReserves: marketStats.solana.virtualSolReserves,
        virtualTokenReserves: marketStats.solana.virtualTokenReserves,
      },
      base: {
        usdcReserves: marketStats.base.usdcReserves,
        tokenReserves: marketStats.base.tokenReserves,
      },
    },
    balances: {
      solana: {
        sol: walletStats?.solana.sol || 0,
        token: walletStats?.solana.token || 0,
      },
      base: {
        eth: walletStats?.base.eth || 0,
        usdc: walletStats?.base.usdc || 0,
        token: walletStats?.base.token || 0,
      },
    },
    stale: false,
  };

  return opportunity;
}

