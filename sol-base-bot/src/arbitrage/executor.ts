import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider, Wallet, formatUnits } from 'ethers';
import { createPumpFunProgram } from '../solana/pumpfun/anchor.js';
import { buildBuyInstruction, buildSellInstruction } from '../solana/pumpfun/instructions.js';
import { createTransaction, sendAndConfirmTransactionWithPolling } from '../solana/pumpfun/transactions.js';
import {
  buyTokensWithUsdc,
  sellTokensForUsdc,
  getTokenDecimals,
  simulateBuyTokensWithUsdc,
  simulateSellTokensForUsdc,
} from '../base/uniswap/router.js';
import { getAllBaseBalances } from '../base/baseBalanceUtils.js';
import type { Opportunity, ArbitrageSimulation } from './types.js';

/**
 * Execute arbitrage trades
 */
export async function executeArbitrage(
  config: {
    SOLANA_TOKEN_MINT: string;
    BASE_TOKEN_ADDRESS: string;
    BASE_USDC_ADDRESS: string;
    UNISWAP_V2_ROUTER02_ADDRESS: string;
    SOLANA_PRIORITY_FEE_SOL: number;
    BASE_SWAP_SLIPPAGE_BPS: number;
    BASE_SWAP_DEADLINE_SECONDS: number;
  },
  opportunity: Opportunity,
  simulation: ArbitrageSimulation,
  solanaConnection: Connection,
  baseProvider: JsonRpcProvider,
  solanaKeypair: Keypair,
  baseWallet: Wallet
): Promise<void> {
  try {
    if (opportunity.direction === 'SOLANA_TO_BASE') {
      // Buy on Solana first
      console.log('📥 Executing buy on Solana...');
      const program = createPumpFunProgram(solanaConnection, solanaKeypair);
      const mint = new PublicKey(config.SOLANA_TOKEN_MINT);
      const buySolanaTokenAmount = opportunity.optimalTradeSize.solana.tokenAmount;
      // Apply 20% slippage buffer (same as simulator)
      const baseSolCost = opportunity.optimalTradeSize.solana.solAmount * LAMPORTS_PER_SOL;
      const maxSolCost = BigInt(Math.floor(baseSolCost * 1.20));

      console.log(`   Using maxSolCost with 20% slippage: ${(Number(maxSolCost) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

      const buyInstruction = await buildBuyInstruction(
        program,
        solanaConnection,
        mint,
        solanaKeypair.publicKey,
        buySolanaTokenAmount,
        maxSolCost,
        false
      );

      const buyTransaction = await createTransaction(
        solanaConnection,
        [buyInstruction],
        solanaKeypair.publicKey,
        config.SOLANA_PRIORITY_FEE_SOL
      );
      buyTransaction.sign(solanaKeypair);

      const buySignature = await sendAndConfirmTransactionWithPolling(
        solanaConnection,
        buyTransaction,
        [solanaKeypair]
      );
      console.log(`   ✅ Buy transaction confirmed: ${buySignature}`);

      // Wait a bit for token balance to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Sell on Base
      console.log('\n📤 Executing sell on Base...');

      // Re-simulate to get fresh amounts
      const sellTokenDecimals = await getTokenDecimals(baseProvider, config.BASE_TOKEN_ADDRESS);
      const sellTokenAmount = opportunity.optimalTradeSize.base.tokenAmount;

      console.log(`   Re-simulating sell transaction...`);
      const freshSellSim = await simulateSellTokensForUsdc(
        baseProvider,
        config.UNISWAP_V2_ROUTER02_ADDRESS,
        config.BASE_USDC_ADDRESS,
        config.BASE_TOKEN_ADDRESS,
        sellTokenAmount,
        baseWallet.address,
        config.BASE_SWAP_SLIPPAGE_BPS,
        config.BASE_SWAP_DEADLINE_SECONDS
      );

      // Calculate amountOutMin with slippage
      const slippageMultiplier = BigInt(10000 - config.BASE_SWAP_SLIPPAGE_BPS);
      const amountOutMin = (freshSellSim.amountOut * slippageMultiplier) / BigInt(10000);

      // Check token balance
      const balances = await getAllBaseBalances(
        baseProvider,
        config.BASE_TOKEN_ADDRESS,
        config.BASE_USDC_ADDRESS,
        baseWallet.address
      );

      const sellTokenAmountFormatted = parseFloat(formatUnits(sellTokenAmount, sellTokenDecimals));

      if (balances.token < sellTokenAmountFormatted) {
        throw new Error(`Insufficient token balance. Required: ${sellTokenAmountFormatted.toFixed(2)}, Available: ${balances.token.toFixed(2)}`);
      }

      console.log(`   Tokens to sell: ${sellTokenAmountFormatted.toFixed(2)}`);
      console.log(`   Tokens available: ${balances.token.toFixed(2)}`);

      const sellResult = await sellTokensForUsdc(
        baseWallet,
        config.UNISWAP_V2_ROUTER02_ADDRESS,
        config.BASE_USDC_ADDRESS,
        config.BASE_TOKEN_ADDRESS,
        sellTokenAmount,
        amountOutMin,
        freshSellSim.deadline,
        config.BASE_SWAP_SLIPPAGE_BPS
      );
      console.log(`   ✅ Sell transaction confirmed: ${sellResult.transactionHash}`);
    } else {
      // Buy on Base first
      console.log('📥 Executing buy on Base...');

      // Re-simulate to get fresh amounts (prices may have changed)
      const buyTokenDecimals = await getTokenDecimals(baseProvider, config.BASE_TOKEN_ADDRESS);
      const buyTokenAmount = opportunity.optimalTradeSize.base.tokenAmount;

      console.log(`   Re-simulating buy transaction...`);
      const freshBuySim = await simulateBuyTokensWithUsdc(
        baseProvider,
        config.UNISWAP_V2_ROUTER02_ADDRESS,
        config.BASE_USDC_ADDRESS,
        config.BASE_TOKEN_ADDRESS,
        buyTokenAmount,
        baseWallet.address,
        config.BASE_SWAP_SLIPPAGE_BPS,
        config.BASE_SWAP_DEADLINE_SECONDS
      );

      // Calculate amountInMax with slippage
      const buySlippageMultiplier = BigInt(10000 + config.BASE_SWAP_SLIPPAGE_BPS);
      const amountInMax = (freshBuySim.amountIn * buySlippageMultiplier) / BigInt(10000);

      // Check USDC balance
      const buyBalances = await getAllBaseBalances(
        baseProvider,
        config.BASE_TOKEN_ADDRESS,
        config.BASE_USDC_ADDRESS,
        baseWallet.address
      );

      const usdcDecimals = await getTokenDecimals(baseProvider, config.BASE_USDC_ADDRESS);
      const amountInMaxFormatted = parseFloat(formatUnits(amountInMax, usdcDecimals));

      if (buyBalances.usdc < amountInMaxFormatted) {
        throw new Error(`Insufficient USDC balance. Required: ${amountInMaxFormatted.toFixed(2)}, Available: ${buyBalances.usdc.toFixed(2)}`);
      }

      console.log(`   USDC needed: ${amountInMaxFormatted.toFixed(2)} USDC`);
      console.log(`   USDC available: ${buyBalances.usdc.toFixed(2)} USDC`);

      const buyResult = await buyTokensWithUsdc(
        baseWallet,
        config.UNISWAP_V2_ROUTER02_ADDRESS,
        config.BASE_USDC_ADDRESS,
        config.BASE_TOKEN_ADDRESS,
        buyTokenAmount,
        amountInMax,
        freshBuySim.deadline,
        config.BASE_SWAP_SLIPPAGE_BPS
      );
      console.log(`   ✅ Buy transaction confirmed: ${buyResult.transactionHash}`);

      // Wait a bit for token balance to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Sell on Solana
      console.log('\n📤 Executing sell on Solana...');
      const program = createPumpFunProgram(solanaConnection, solanaKeypair);
      const mint = new PublicKey(config.SOLANA_TOKEN_MINT);
      const sellSolanaTokenAmount = opportunity.optimalTradeSize.solana.tokenAmount;
      const minSolOutput = BigInt(Math.floor(opportunity.optimalTradeSize.solana.solAmount * LAMPORTS_PER_SOL * 0.98));

      const sellInstruction = await buildSellInstruction(
        program,
        solanaConnection,
        mint,
        solanaKeypair.publicKey,
        sellSolanaTokenAmount,
        minSolOutput
      );

      const sellTransaction = await createTransaction(
        solanaConnection,
        [sellInstruction],
        solanaKeypair.publicKey,
        config.SOLANA_PRIORITY_FEE_SOL
      );
      sellTransaction.sign(solanaKeypair);

      const sellSignature = await sendAndConfirmTransactionWithPolling(
        solanaConnection,
        sellTransaction,
        [solanaKeypair]
      );
      console.log(`   ✅ Sell transaction confirmed: ${sellSignature}`);
    }

    console.log('\n✅ Arbitrage execution completed!');
  } catch (error) {
    console.error('Error executing arbitrage:', error);
    throw error;
  }
}

