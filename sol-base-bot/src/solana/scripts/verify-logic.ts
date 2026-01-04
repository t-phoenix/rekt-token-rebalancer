import { analyzeOpportunity } from '../../arbitrage/opportunityAnalyzer.js';
import type { MarketStats } from '../../arbitrage/marketFetcher.js';
import { JsonRpcProvider } from 'ethers';

// Mock Provider (not used if decimals are in stats)
const mockProvider = new JsonRpcProvider('');

// Fee constants matches implementation
const PUMPFUN_FEE_BPS = 100n;
const UNISWAP_FEE_BPS = 30n;
const BPS_DENOMINATOR = 10000n;

function calculatePumpFunMarginalPrice(vSol: bigint, vToken: bigint, tradeSize: bigint, isBuy: boolean): number {
    const k = vSol * vToken;
    let newVToken: bigint;
    if (isBuy) {
        newVToken = vToken - tradeSize;
    } else {
        newVToken = vToken + tradeSize;
    }
    const newVSol = k / newVToken;
    return Number(newVSol) / Number(newVToken);
}

function calculateUniswapMarginalPrice(usdcRes: bigint, tokenRes: bigint, tradeSize: bigint, isBuy: boolean): number {
    const k = usdcRes * tokenRes;
    let newTokenRes: bigint;
    if (isBuy) {
        newTokenRes = tokenRes - tradeSize;
    } else {
        newTokenRes = tokenRes + tradeSize;
    }
    const newUsdcRes = k / newTokenRes;
    return Number(newUsdcRes) / Number(newTokenRes);
}

async function runVerification() {
    console.log('🚀 Starting Arbitrage Logic Verification (Equilibrium Approach)');

    // Scenario: Solana is CHEAPER than Base.
    // We expect the bot to BUY on Solana (push price UP) and SELL on Base (push price DOWN)
    // untl Price_Sol_Marginal ≈ Price_Base_Marginal

    const vSol = 30n * 1000000000n; // 30 SOL
    const vToken = 1000000000n * 1000000n; // 1B tokens (6 decimals)

    // Solana Price = 4.5e-6 $
    const solPriceNative = (Number(vSol) / 1e9) / (Number(vToken) / 1e6);
    const solPriceUsd = solPriceNative * 150; // $150 per SOL

    // Create Base reserves with ~5% gap (Base slightly more expensive)
    // Target Base Price = 1.05 * SolPrice = 1.05 * 0.0000045 = 0.000004725
    // Base Price = 1 / (Tokens / USDC) = USDC / Tokens
    // 10000 USDC / X Tokens = 0.000004725
    // X = 10000 / 0.000004725 = 2,116,402,116

    const usdcRes = 10000n * 1000000n; // 10,000 USDC
    const tokenRes = 2116402116n * 1000000n; // ~2.1B tokens

    // Initial Price calculation will confirm gap.

    // Normalize Price calculation for MarketStats
    const marketStats: MarketStats = {
        solana: {
            price: solPriceNative,
            priceUsd: solPriceUsd,
            liquidity: 0,
            liquidityUsd: 0,
            marketCapUsd: 0,
            virtualSolReserves: vSol,
            virtualTokenReserves: vToken,
            realSolReserves: vSol,
            realTokenReserves: vToken / 2n, // 500M real tokens (Limit 50M)
            tokenDecimals: 6
        },
        base: {
            price: Number(usdcRes) / Number(tokenRes),
            priceUsd: (Number(usdcRes) / 1e6) / (Number(tokenRes) / 1e6),
            liquidity: 0,
            liquidityUsd: 0,
            usdcReserves: usdcRes,
            tokenReserves: tokenRes,
            usdcDecimals: 6,
            tokenDecimals: 6
        }
    };

    console.log('\n📊 Initial State:');
    console.log(`Solana Price: $${marketStats.solana.priceUsd.toFixed(8)}`);
    console.log(`Base Price:   $${marketStats.base.priceUsd.toFixed(8)}`);

    // Run Analyzer
    const opportunity = await analyzeOpportunity({
        MIN_PROFIT_THRESHOLD: 0.01, // 1%
        TRADE_SIZE_USD: 1000, // Max Trade $1000
        SOLANA_SOL_PRICE_USD: 150,
        BASE_TOKEN_ADDRESS: '0x...',
        BASE_USDC_ADDRESS: '0x...',
        COINMARKETCAP_API_KEY: ''
    }, marketStats, null, mockProvider);

    if (!opportunity) {
        console.error('❌ No opportunity found (Failed)');
        return;
    }

    const tradeSize = opportunity.optimalTradeSize.solana.tokenAmount;
    console.log(`\n✅ Opportunity Found! Optimal Trade Size: ${Number(tradeSize) / 1000000} Tokens`);

    // SIMULATE EXECUTION
    // 1. Buy on PumpFun (remove tokens from pool) (Inputs SOL, Outputs TOKENS)
    // Actually, Buy removes tokens from Virtual Reserves.
    // Price = vSol / vToken. Removing tokens = vToken decreases = Price increases.
    // Input is tradeSize (Tokens).
    // Post-Trade Reserves:
    // vToken_new = vToken - tradeSize.
    // vSol_new = k / vToken_new.
    // Marginal Price = vSol_new / vToken_new.

    // WAIT! calculatePumpFunMarginalPrice(..., isBuy=true) 
    // If IS_BUY (Buy Tokens), we remove tokens. 
    // my function: if (isBuy) newVToken = vToken - tradeSize.
    // Correct.

    const solBuySize = tradeSize;
    const newPriceSolNative = calculatePumpFunMarginalPrice(
        marketStats.solana.virtualSolReserves,
        marketStats.solana.virtualTokenReserves,
        solBuySize,
        true // Buy
    );
    // Convert Native Price (Lamport/RawToken) to Normalized?
    // calculatePumpFunMarginalPrice returns vSol/vToken (Raw Ratio).
    // Normalize: Ratio * 1e-3.
    const newPriceSolNormalized = newPriceSolNative * 1e-3;
    const newPriceSolUsd = newPriceSolNormalized * 150;

    // 2. Sell on Base (add tokens to pool) (Inputs TOKENS, Outputs USDC)
    // isBuy=false.
    // newVToken = vToken + tradeSize.
    const baseSellSize = tradeSize;
    const newPriceBaseNative = calculateUniswapMarginalPrice(
        marketStats.base.usdcReserves,
        marketStats.base.tokenReserves,
        baseSellSize,
        false // Sell
    );
    // Base Decimals: USDC 6, Token 6.
    // Ratio = USDC / Token.
    // Normalize = Ratio.
    const newPriceBaseUsd = newPriceBaseNative; // USDC=1

    console.log('\n🔄 Post-Trade Marginal Prices:');
    console.log(`Solana: $${newPriceSolUsd.toFixed(8)}`);
    console.log(`Base:   $${newPriceBaseUsd.toFixed(8)}`);

    const diff = Math.abs(newPriceSolUsd - newPriceBaseUsd);
    const diffPercent = (diff / newPriceSolUsd) * 100;
    console.log(`Difference: ${diffPercent.toFixed(4)}%`);

    if (diffPercent < 5.0) { // Allow some slack due to fees and binary search steps
        console.log('✅ Prices converged significantly!');
    } else {
        console.warn('⚠️ Prices did not converge fully (might be constrained by max trade size)');
        if (Number(tradeSize) / 1000000 * marketStats.solana.priceUsd < 900) {
            // If we didn't hit max trade size ($1000), we should have converged
            console.error('❌ Failed to converge within limits');
        } else {
            console.log('ℹ️  Trade size capped by max limit ($1000), partial convergence ok.');
        }
    }
}

runVerification().catch(console.error);
