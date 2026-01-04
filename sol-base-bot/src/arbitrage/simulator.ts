import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider, Wallet } from 'ethers';
import { createPumpFunProgram } from '../solana/pumpfun/anchor.js';
import { buildBuyInstruction, buildSellInstruction } from '../solana/pumpfun/instructions.js';
import { createTransaction, simulateTransaction } from '../solana/pumpfun/transactions.js';
import {
  simulateBuyTokensWithUsdc,
  simulateSellTokensForUsdc,
  getTokenDecimals,
} from '../base/uniswap/router.js';
import { getPriceFetcher } from '../utils/priceFetcher.js';
import type { Opportunity, ArbitrageSimulation, SimulationResult } from './types.js';

/**
 * Simulate arbitrage transactions on both chains
 */
export async function simulateArbitrage(
  config: {
    SOLANA_TOKEN_MINT: string;
    BASE_TOKEN_ADDRESS: string;
    BASE_USDC_ADDRESS: string;
    UNISWAP_V2_ROUTER02_ADDRESS: string;
    SOLANA_SOL_PRICE_USD: number;
    SOLANA_PRIORITY_FEE_SOL: number;
    BASE_SWAP_SLIPPAGE_BPS: number;
    BASE_SWAP_DEADLINE_SECONDS: number;
    MIN_PROFIT_THRESHOLD: number;
    COINMARKETCAP_API_KEY: string;
  },
  opportunity: Opportunity,
  solanaConnection: Connection,
  baseProvider: JsonRpcProvider,
  solanaKeypair: Keypair | null,
  baseWallet: Wallet | null
): Promise<ArbitrageSimulation | null> {
  try {
    // Get prices from CoinMarketCap if available, otherwise use fallback
    let ethPrice = 3300; // Default fallback
    let solPrice = config.SOLANA_SOL_PRICE_USD; // Default fallback
    if (config.COINMARKETCAP_API_KEY) {
      try {
        const priceFetcher = getPriceFetcher();
        const prices = await priceFetcher.getPrices();
        ethPrice = prices.eth;
        solPrice = prices.sol;
      } catch (error) {
        console.warn('⚠️  Failed to fetch prices, using fallback:', error);
      }
    }

    let buySimulation: SimulationResult | null = null;
    let sellSimulation: SimulationResult | null = null;
    let buyError: string | null = null;
    let sellError: string | null = null;

    if (opportunity.direction === 'SOLANA_TO_BASE') {
      // Buy on Solana, sell on Base
      if (solanaKeypair) {
        const program = createPumpFunProgram(solanaConnection, solanaKeypair);
        const mint = new PublicKey(config.SOLANA_TOKEN_MINT);
        const tokenAmount = opportunity.optimalTradeSize.solana.tokenAmount;
        // Try with 20% slippage buffer initially
        const baseSolCost = opportunity.optimalTradeSize.solana.solAmount * LAMPORTS_PER_SOL;
        const maxSolCost = BigInt(Math.floor(baseSolCost * 1.20));

        console.log(`   🔄 Attempting Solana buy with 20% slippage buffer (${(opportunity.optimalTradeSize.solana.solAmount * 1.20).toFixed(6)} SOL max)`);

        const instruction = await buildBuyInstruction(
          program,
          solanaConnection,
          mint,
          solanaKeypair.publicKey,
          tokenAmount,
          maxSolCost,
          false
        );

        const transaction = await createTransaction(
          solanaConnection,
          [instruction],
          solanaKeypair.publicKey,
          config.SOLANA_PRIORITY_FEE_SOL
        );
        transaction.sign(solanaKeypair);

        const simResult = await simulateTransaction(solanaConnection, transaction, solanaKeypair);

        if (!simResult.value.err) {
          const actualSolCost = Number(maxSolCost) / LAMPORTS_PER_SOL;
          buySimulation = {
            chain: 'solana',
            type: 'buy',
            inputAmount: maxSolCost,
            outputAmount: tokenAmount,
            inputAmountFormatted: actualSolCost,
            outputAmountFormatted: Number(tokenAmount) / 1e6, // Use actual decimals (6 for PumpFun)
            priceImpact: 20,
            gasEstimate: BigInt(simResult.value.unitsConsumed || 0),
            gasCostUsd: (actualSolCost * solPrice * 0.01),
            slippage: 20,
            success: true,
          };
          console.log(`   ✅ Solana buy simulation succeeded with 20% slippage`);
        } else {
          buyError = `Solana buy simulation failed: ${JSON.stringify(simResult.value.err)}`;
          console.error(`❌ ${buyError}`);
        }
      }

      if (baseWallet) {
        try {
          const tokenAmount = opportunity.optimalTradeSize.base.tokenAmount;
          const sellSim = await simulateSellTokensForUsdc(
            baseProvider,
            config.UNISWAP_V2_ROUTER02_ADDRESS,
            config.BASE_USDC_ADDRESS,
            config.BASE_TOKEN_ADDRESS,
            tokenAmount,
            baseWallet.address,
            config.BASE_SWAP_SLIPPAGE_BPS,
            config.BASE_SWAP_DEADLINE_SECONDS
          );

          sellSimulation = {
            chain: 'base',
            type: 'sell',
            inputAmount: tokenAmount,
            outputAmount: sellSim.amountOut,
            inputAmountFormatted: sellSim.amountInFormatted,
            outputAmountFormatted: sellSim.amountOutFormatted,
            priceImpact: 0,
            gasEstimate: sellSim.gasEstimate,
            gasCostUsd: sellSim.gasCostEthFormatted * ethPrice,
            slippage: 0,
            success: true,
          };
        } catch (error: any) {
          sellError = `Base sell simulation error: ${error.message || error}`;
          console.error(`❌ ${sellError}`);
          if (error.message?.includes('underflow') || error.message?.includes('ds-math')) {
            sellError += ' (Likely insufficient liquidity - trade size exceeds pool capacity)';
          }
        }
      }
    } else {
      // Buy on Base, sell on Solana
      if (baseWallet) {
        const tokenAmount = opportunity.optimalTradeSize.base.tokenAmount;
        const tokenDecimalsRaw = await getTokenDecimals(baseProvider, config.BASE_TOKEN_ADDRESS);
        const tokenDecimals = Number(tokenDecimalsRaw);
        const tokenAmountFormatted = Number(tokenAmount) / (10 ** tokenDecimals);

        console.log(`   Attempting to buy ${tokenAmountFormatted.toFixed(2)} tokens on Base...`);

        try {
          const buySim = await simulateBuyTokensWithUsdc(
            baseProvider,
            config.UNISWAP_V2_ROUTER02_ADDRESS,
            config.BASE_USDC_ADDRESS,
            config.BASE_TOKEN_ADDRESS,
            tokenAmount,
            baseWallet.address,
            config.BASE_SWAP_SLIPPAGE_BPS,
            config.BASE_SWAP_DEADLINE_SECONDS
          );

          buySimulation = {
            chain: 'base',
            type: 'buy',
            inputAmount: buySim.amountIn,
            outputAmount: tokenAmount,
            inputAmountFormatted: buySim.amountInFormatted,
            outputAmountFormatted: buySim.amountOutFormatted,
            priceImpact: 0,
            gasEstimate: buySim.gasEstimate,
            gasCostUsd: buySim.gasCostEthFormatted * ethPrice,
            slippage: 0,
            success: true,
          };
        } catch (error: any) {
          console.error(`   ❌ Base buy simulation failed: ${error.message || error}`);
          if (error.message?.includes('underflow') || error.message?.includes('ds-math')) {
            console.error(`   ⚠️  Trade size may be too large for available liquidity.`);
            console.error(`   💡 Try reducing TRADE_SIZE_USD in config or check pool liquidity.`);
          }
          return null;
        }
      }

      if (solanaKeypair) {
        const program = createPumpFunProgram(solanaConnection, solanaKeypair);
        const mint = new PublicKey(config.SOLANA_TOKEN_MINT);
        const tokenAmount = opportunity.optimalTradeSize.solana.tokenAmount;
        const minSolOutput = BigInt(Math.floor(opportunity.optimalTradeSize.solana.solAmount * LAMPORTS_PER_SOL * 0.98)); // 2% slippage

        const instruction = await buildSellInstruction(
          program,
          solanaConnection,
          mint,
          solanaKeypair.publicKey,
          tokenAmount,
          minSolOutput
        );

        const transaction = await createTransaction(
          solanaConnection,
          [instruction],
          solanaKeypair.publicKey,
          config.SOLANA_PRIORITY_FEE_SOL
        );
        transaction.sign(solanaKeypair);

        const simResult = await simulateTransaction(solanaConnection, transaction, solanaKeypair);

        if (!simResult.value.err) {
          const solOutput = opportunity.optimalTradeSize.solana.solAmount;
          sellSimulation = {
            chain: 'solana',
            type: 'sell',
            inputAmount: tokenAmount,
            outputAmount: BigInt(Math.floor(solOutput * LAMPORTS_PER_SOL)),
            inputAmountFormatted: Number(tokenAmount) / 1e9,
            outputAmountFormatted: solOutput,
            priceImpact: 0,
            gasEstimate: BigInt(simResult.value.unitsConsumed || 0),
            gasCostUsd: (solOutput * 0.01),
            slippage: 0,
            success: true,
          };
        }
      }
    }

    if (!buySimulation || !sellSimulation || !buySimulation.success || !sellSimulation.success) {
      let failureReason = 'Simulation failed: ';
      const failures: string[] = [];

      if (!buySimulation || !buySimulation.success) {
        failures.push(buyError || 'Buy simulation failed (no wallet or unknown error)');
      }
      if (!sellSimulation || !sellSimulation.success) {
        failures.push(sellError || 'Sell simulation failed (no wallet or unknown error)');
      }

      failureReason += failures.join(' | ');
      console.error(`❌ ${failureReason}`);

      return {
        opportunity,
        buySimulation: buySimulation!,
        sellSimulation: sellSimulation!,
        netProfitUsd: 0,
        netProfitPercent: 0,
        totalCostUsd: 0,
        totalRevenueUsd: 0,
        executionTimeEstimate: 0,
        riskScore: 0,
        success: false,
        warnings: [],
        failureReason
      };
    }

    // Calculate net profit
    const totalCost = buySimulation.inputAmountFormatted * (buySimulation.chain === 'solana' ? solPrice : 1) + buySimulation.gasCostUsd;
    const totalRevenue = sellSimulation.outputAmountFormatted * (sellSimulation.chain === 'solana' ? solPrice : 1) - sellSimulation.gasCostUsd;
    const netProfitUsd = totalRevenue - totalCost;
    const netProfitPercent = (netProfitUsd / totalCost) * 100;

    if (netProfitUsd < config.MIN_PROFIT_THRESHOLD * totalCost) {
      const reason = `Net Profit ($${netProfitUsd.toFixed(4)}) is below threshold ($${(config.MIN_PROFIT_THRESHOLD * totalCost).toFixed(4)}). Gas costs ($${(buySimulation.gasCostUsd + sellSimulation.gasCostUsd).toFixed(4)}) exceed profit.`;
      console.log(`❌ Simulation not profitable: ${reason}`);
      return {
        opportunity,
        buySimulation,
        sellSimulation,
        netProfitUsd,
        netProfitPercent,
        totalCostUsd: totalCost,
        totalRevenueUsd: totalRevenue,
        executionTimeEstimate: 30000,
        riskScore: 50,
        success: false,
        warnings: [],
        failureReason: reason
      };
    }

    return {
      opportunity,
      buySimulation,
      sellSimulation,
      netProfitUsd,
      netProfitPercent,
      totalCostUsd: totalCost,
      totalRevenueUsd: totalRevenue,
      executionTimeEstimate: 30000, // 30 seconds
      riskScore: 50, // Placeholder
      success: true,
      warnings: [],
    };
  } catch (error: any) {
    console.error('Error simulating arbitrage:', error);
    // Return a failed simulation object instead of null to allow main.ts to display reason
    // We need to mock the required fields or make them optional in types if we want to return partial.
    // For now, let's just return null but log heavily. Pushing a structural change to allow partial return is better.
    // Actually, main.ts expects NonNullable result to proceed? No, it checks !simulation || !simulation.success.
    // So returning an object with success:false is supported if we can populate the rest.
    // Since we lack simulations, we can't really populate the rest.
    // Let's stick to null return for catastrophic failures, but ensure the error log is visible.
    return {
      opportunity,
      buySimulation: null as any, // Hack for safe fail
      sellSimulation: null as any,
      netProfitUsd: 0,
      netProfitPercent: 0,
      totalCostUsd: 0,
      totalRevenueUsd: 0,
      executionTimeEstimate: 0,
      riskScore: 0,
      success: false,
      warnings: [],
      failureReason: `Simulation Crash: ${error.message || error}`
    };
  }
}

