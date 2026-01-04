import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { MarketStats } from './marketFetcher.js';
import type { WalletStats } from './walletStats.js';
import type { Opportunity, ArbitrageSimulation } from './types.js';

/**
 * Display market statistics
 */
export function displayMarketStats(stats: MarketStats, config: any) {
  console.log('\n📈 MARKET STATISTICS');
  console.log('═'.repeat(100));

  // Price comparison table
  const priceData = {
    '🔵 Solana (PumpFun)': {
      'Price (SOL/token)': stats.solana.price.toFixed(9),
      'Price (USD)': `$${stats.solana.priceUsd.toFixed(8)}`,
      'Liquidity': `${stats.solana.liquidity.toFixed(4)} SOL`,
      'Liquidity (USD)': `$${stats.solana.liquidityUsd.toFixed(2)}`,
    },
    '🟦 Base (Uniswap V2)': {
      'Price (SOL/token)': `${stats.base.price.toFixed(6)} USDC`,
      'Price (USD)': `$${stats.base.priceUsd.toFixed(8)}`,
      'Liquidity': `${stats.base.liquidity.toFixed(4)} USDC`,
      'Liquidity (USD)': `$${stats.base.liquidityUsd.toFixed(4)}`,
    }
  };

  console.log('\n💰 PRICE & LIQUIDITY COMPARISON:');
  console.table(priceData);

  // Reserves table
  const reservesData = {
    '🔵 Solana': {
      'SOL Reserves': `${(Number(stats.solana.realSolReserves) / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
      'Token Reserves': `${(Number(stats.solana.realTokenReserves) / 10 ** stats.solana.tokenDecimals).toLocaleString()} tokens`,
      'Token Decimals': stats.solana.tokenDecimals,
    },
    '🟦 Base': {
      'SOL Reserves': `${(Number(stats.base.usdcReserves) / 10 ** stats.base.usdcDecimals).toLocaleString()} USDC`,
      'Token Reserves': `${(Number(stats.base.tokenReserves) / 10 ** stats.base.tokenDecimals).toLocaleString()} tokens`,
      'Token Decimals': stats.base.tokenDecimals,
    }
  };

  console.log('\n📊 RESERVES BREAKDOWN:');
  console.table(reservesData);

  // Price difference analysis
  const priceDiffUsd = stats.base.priceUsd - stats.solana.priceUsd;
  const priceDiffPercent = (priceDiffUsd / stats.solana.priceUsd) * 100;

  const priceDiffData = {
    'Analysis': {
      'Solana Price': `$${stats.solana.priceUsd.toFixed(8)}`,
      'Base Price': `$${stats.base.priceUsd.toFixed(8)}`,
      'Difference (USD)': `${priceDiffUsd > 0 ? '+' : ''}$${priceDiffUsd.toFixed(8)}`,
      'Difference (%)': `${priceDiffPercent > 0 ? '+' : ''}${priceDiffPercent.toFixed(2)}%`,
      'Direction': priceDiffUsd > 0 ? '📈 Base more expensive' : '📉 Solana more expensive',
    }
  };

  console.log('\n💹 PRICE DIFFERENCE ANALYSIS:');
  console.table(priceDiffData);
  console.log('═'.repeat(100));
}

/**
 * Display wallet statistics
 */
export function displayWalletStats(stats: WalletStats, marketStats: MarketStats | null) {
  console.log('\n💰 WALLET BALANCES');
  console.log('═'.repeat(100));

  const walletData: any = {};

  if (stats.solana.totalUsd > 0) {
    walletData['🔵 Solana Wallet'] = {
      'SOL': `${stats.solana.sol.toFixed(4)} SOL`,
      'SOL (USD)': `$${stats.solana.solUsd.toFixed(2)}`,
      'Token': `${stats.solana.token.toFixed(2)}`,
      'Token (USD)': `$${stats.solana.tokenUsd.toFixed(2)}`,
      'Total (USD)': `$${stats.solana.totalUsd.toFixed(2)}`,
    };
  }

  if (stats.base.totalUsd > 0) {
    const tokenPriceUsd = marketStats?.base.priceUsd || 0;
    walletData['🟦 Base Wallet'] = {
      'SOL': `${stats.base.eth.toFixed(4)} ETH`,
      'SOL (USD)': `$${stats.base.ethUsd.toFixed(2)}`,
      'Token': `${stats.base.token.toFixed(2)}`,
      'Token (USD)': `$${(stats.base.token * tokenPriceUsd).toFixed(2)}`,
      'Total (USD)': `$${stats.base.totalUsd.toFixed(2)}`,
    };
    // Add USDC row separately
    walletData['🟦 Base Wallet']['USDC'] = `${stats.base.usdc.toFixed(2)}`;
  }

  console.table(walletData);
  console.log('═'.repeat(100));
}

/**
 * Display opportunity
 */
export function displayOpportunity(opportunity: Opportunity, config: any, marketStats: MarketStats) {
  console.log('\n🎯 ARBITRAGE OPPORTUNITY');
  console.log('═'.repeat(100));

  // Opportunity summary
  const summaryData = {
    'Opportunity': {
      'Direction': opportunity.direction === 'SOLANA_TO_BASE' ? '🔵 Buy Solana → 🟦 Sell Base' : '🟦 Buy Base → 🔵 Sell Solana',
      'Price Difference': `${opportunity.priceDifferencePercent.toFixed(2)}%`,
      'Estimated Profit': `$${opportunity.estimatedProfitUsd.toFixed(2)}`,
      'Profit Percent': `${opportunity.estimatedProfitPercent.toFixed(2)}%`,
    }
  };

  console.table(summaryData);

  const solDecimals = marketStats.solana.tokenDecimals;
  const baseDecimals = marketStats.base.tokenDecimals;
  const usdcDecimals = marketStats.base.usdcDecimals;

  console.log('\n📝 TRADE DETAILS:');

  if (opportunity.direction === 'SOLANA_TO_BASE') {
    // Buy on Solana
    const solAmount = opportunity.optimalTradeSize.solana.solAmount;
    const tokenAmount = Number(opportunity.optimalTradeSize.solana.tokenAmount) / (10 ** solDecimals);

    // Sell on Base
    const usdcAmount = Number(opportunity.optimalTradeSize.base.usdcAmount) / (10 ** usdcDecimals);
    const baseTokenAmount = Number(opportunity.optimalTradeSize.base.tokenAmount) / (10 ** baseDecimals);

    const tradeData = {
      '🔵 BUY on Solana': {
        'Input': `${solAmount.toFixed(6)} SOL`,
        'Input (USD)': `$${(solAmount * config.SOLANA_SOL_PRICE_USD).toFixed(2)}`,
        'Output': `${tokenAmount.toFixed(4)} Tokens`,
        'Price': `${marketStats.solana.price.toFixed(9)} SOL/token`,
        'Calculation': `${solAmount.toFixed(6)} SOL ÷ ${marketStats.solana.price.toFixed(9)} = ${tokenAmount.toFixed(4)} Tokens`,
      },
      '🟦 SELL on Base': {
        'Input': `${baseTokenAmount.toFixed(4)} Tokens`,
        'Input (USD)': '-',
        'Output': `${usdcAmount.toFixed(2)} USDC`,
        'Price': `$${marketStats.base.price.toFixed(6)}/token`,
        'Calculation': `${baseTokenAmount.toFixed(4)} Tokens × $${marketStats.base.price.toFixed(6)} = $${(baseTokenAmount * marketStats.base.price).toFixed(2)}`,
      }
    };

    console.table(tradeData);

  } else {
    // Buy on Base
    const usdcAmount = Number(opportunity.optimalTradeSize.base.usdcAmount) / (10 ** usdcDecimals);
    const tokenAmount = Number(opportunity.optimalTradeSize.base.tokenAmount) / (10 ** baseDecimals);

    // Sell on Solana
    const solAmount = opportunity.optimalTradeSize.solana.solAmount;
    const solTokenAmount = Number(opportunity.optimalTradeSize.solana.tokenAmount) / (10 ** solDecimals);

    const tradeData = {
      '🟦 BUY on Base': {
        'Input': `${usdcAmount.toFixed(2)} USDC`,
        'Input (USD)': `$${usdcAmount.toFixed(2)}`,
        'Output': `${tokenAmount.toFixed(4)} Tokens`,
        'Price': `$${marketStats.base.price.toFixed(6)}/token`,
        'Calculation': `${usdcAmount.toFixed(2)} USDC ÷ $${marketStats.base.price.toFixed(6)} = ${tokenAmount.toFixed(4)} Tokens`,
      },
      '🔵 SELL on Solana': {
        'Input': `${solTokenAmount.toFixed(4)} Tokens`,
        'Input (USD)': '-',
        'Output': `${solAmount.toFixed(6)} SOL`,
        'Price': `${marketStats.solana.price.toFixed(9)} SOL/token`,
        'Calculation': `${solTokenAmount.toFixed(4)} Tokens × ${marketStats.solana.price.toFixed(9)} = ${solAmount.toFixed(6)} SOL ($${(solAmount * config.SOLANA_SOL_PRICE_USD).toFixed(2)})`,
      }
    };

    console.table(tradeData);
  }

  console.log('═'.repeat(100));
}

/**
 * Display simulation results
 */
export function displaySimulationResults(simulation: ArbitrageSimulation, config: any) {
  console.log('\n🧪 SIMULATION RESULTS');
  console.log('═'.repeat(100));

  // Transaction details table
  const transactionData = {
    '📥 BUY Transaction': {
      'Chain': simulation.buySimulation.chain === 'solana' ? '🔵 Solana' : '🟦 Base',
      'Type': simulation.buySimulation.type,
      'Input': `${simulation.buySimulation.inputAmountFormatted.toFixed(6)} ${simulation.buySimulation.chain === 'solana' ? 'SOL' : 'USDC'}`,
      'Output': `${simulation.buySimulation.outputAmountFormatted.toFixed(2)} tokens`,
      'Gas Cost': `$${simulation.buySimulation.gasCostUsd.toFixed(4)}`,
    },
    '📤 SELL Transaction': {
      'Chain': simulation.sellSimulation.chain === 'solana' ? '🔵 Solana' : '🟦 Base',
      'Type': simulation.sellSimulation.type,
      'Input': `${simulation.sellSimulation.inputAmountFormatted.toFixed(6)} tokens`,
      'Output': `${simulation.sellSimulation.outputAmountFormatted.toFixed(6)} ${simulation.sellSimulation.chain === 'solana' ? 'SOL' : 'USDC'}`,
      'Gas Cost': `$${simulation.sellSimulation.gasCostUsd.toFixed(4)}`,
    }
  };

  console.log('\n� TRANSACTION BREAKDOWN:');
  console.table(transactionData);

  // Profit analysis table
  const profitData = {
    'Profit Analysis': {
      'Total Cost': `$${simulation.totalCostUsd.toFixed(2)}`,
      'Total Revenue': `$${simulation.totalRevenueUsd.toFixed(2)}`,
      'Net Profit (USD)': `$${simulation.netProfitUsd.toFixed(2)}`,
      'Net Profit (%)': `${simulation.netProfitPercent.toFixed(2)}%`,
      'Execution Time': `${(simulation.executionTimeEstimate / 1000).toFixed(1)}s`,
      'Status': simulation.netProfitUsd > 0 ? '✅ Profitable' : '❌ Not Profitable',
    }
  };

  console.log('\n💰 PROFIT ANALYSIS:');
  console.table(profitData);
  console.log('═'.repeat(100));
}


