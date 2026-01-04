import { loadConfig } from '../../config.js';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  calculatePumpFunBuyPrice,
  calculatePumpFunSellPrice,
} from '../pumpfun/pricing.js';
import { getCoinData } from '../pumpfun/api.js';
import { formatTable } from '../../utils/formatters.js';

async function testPricing() {
  const config = loadConfig();

  console.log('\n' + '='.repeat(70));
  console.log('🚀 ARBITRAGE BOT - PRICING TEST (Real-time PumpFun)');
  console.log('='.repeat(70) + '\n');

  // Get token address
  const solanaMint = config.SOLANA_TOKEN_MINT || config.SOLANA_TOKEN_MINTS?.split(',')[0]?.trim();
  if (!solanaMint) {
    throw new Error('Missing SOLANA_TOKEN_MINT or SOLANA_TOKEN_MINTS');
  }

  console.log('📋 Token Configuration:');
  console.log(`   Token Address on Solana: ${solanaMint}`);
  console.log(`   SOL Price (USD): ${config.SOLANA_SOL_PRICE_USD}\n`);

  // Setup connection (not needed for simple pricing, but keeping for consistency)
  const connection = new Connection(config.SOLANA_RPC_HTTP_URL, 'confirmed');

  // Fetch coin data
  console.log('📊 Fetching PumpFun coin data...\n');
  const coinData = await getCoinData(solanaMint);
  if (!coinData) {
    throw new Error('Failed to fetch PumpFun coin data. Token may not exist on PumpFun.');
  }

  const vSol = BigInt(coinData['virtual_sol_reserves']);
  const vToken = BigInt(coinData['virtual_token_reserves']);

  if (vSol <= 0n || vToken <= 0n) {
    throw new Error('Invalid PumpFun reserves');
  }

  console.log('📈 Pool Information:');
  console.log(`   Virtual SOL Reserves: ${(Number(vSol) / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`   Virtual Token Reserves: ${Number(vToken).toLocaleString()} tokens\n`);

  // Test different token amounts
  const tokenAmounts = [1000000, 10000000, 100000000, 1000000000, 10000000000];
  
  console.log('🔄 Calculating BUY prices using bonding curve formula...\n');
  
  const buyPrices: Array<{
    amount: number;
    solPerToken: number;
    totalSol: number;
    totalUsd: number;
  }> = [];

  for (const amount of tokenAmounts) {
    const price = await calculatePumpFunBuyPrice(
      solanaMint,
      amount,
      config.SOLANA_SOL_PRICE_USD
    );


    if (price) {
      buyPrices.push({ amount, ...price });
      console.log(`   ✓ Buy ${amount.toLocaleString()} tokens: ${price.totalSol.toFixed(18)} SOL (${price.solPerToken.toExponential(18)} SOL/token)`);
    } else {
      console.log(`   ✗ Failed to calculate buy price for ${amount.toLocaleString()} tokens`);
    }
  }

  console.log('\n🔄 Calculating SELL prices using bonding curve formula...\n');

  const sellPrices: Array<{
    amount: number;
    solPerToken: number;
    totalSol: number;
    totalUsd: number;
  }> = [];

  for (const amount of tokenAmounts) {
    const price = await calculatePumpFunSellPrice(
      solanaMint,
      amount,
      config.SOLANA_SOL_PRICE_USD
    );

    if (price) {
      sellPrices.push({ amount, ...price });
      console.log(`   ✓ Sell ${amount.toLocaleString()} tokens: ${price.totalSol.toFixed(18)} SOL (${price.solPerToken.toExponential(18)} SOL/token)`);
    } else {
      console.log(`   ✗ Failed to calculate sell price for ${amount.toLocaleString()} tokens`);
    }
  }

  // Display results in tables
  if (buyPrices.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('💰 BUY PRICES (SOL per Token)');
    console.log('='.repeat(70));
    
    const buyHeaders = ['Token Amount', 'Price (SOL/Token)', 'Total Cost (SOL)', 'Total Cost (USD)'];
    const buyRows = buyPrices.map(p => [
      p.amount.toLocaleString(),
      p.solPerToken.toExponential(18),
      p.totalSol.toFixed(18),
      p.totalUsd.toFixed(18),
    ]);
    
    console.log(formatTable(buyHeaders, buyRows));
  }

  if (sellPrices.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('💸 SELL PRICES (SOL per Token)');
    console.log('='.repeat(70));
    
    const sellHeaders = ['Token Amount', 'Price (SOL/Token)', 'Total Receive (SOL)', 'Total Receive (USD)'];
    const sellRows = sellPrices.map(p => [
      p.amount.toLocaleString(),
      p.solPerToken.toExponential(18),
      p.totalSol.toFixed(18),
      p.totalUsd.toFixed(18),
    ]);
    
    console.log(formatTable(sellHeaders, sellRows));
  }

  // Compare buy vs sell prices
  if (buyPrices.length > 0 && sellPrices.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('📊 BUY vs SELL COMPARISON (1 Token)');
    console.log('='.repeat(70));
    
    const buyPrice1Token = buyPrices[0];
    const sellPrice1Token = sellPrices[0];
    
    const spread = buyPrice1Token.totalSol - sellPrice1Token.totalSol;
    const spreadPercent = (spread / buyPrice1Token.totalSol) * 100;
    
    const comparisonHeaders = ['Metric', 'Value'];
    const comparisonRows = [
      ['Buy Price (SOL)', buyPrice1Token.totalSol.toFixed(18)],
      ['Sell Price (SOL)', sellPrice1Token.totalSol.toFixed(18)],
      ['Spread (SOL)', spread.toFixed(18)],
      ['Spread (%)', `${spreadPercent.toFixed(4)}%`],
      ['Buy Price (SOL/Token)', buyPrice1Token.solPerToken.toExponential(18)],
      ['Sell Price (SOL/Token)', sellPrice1Token.solPerToken.toExponential(18)],
    ];
    
    console.log(formatTable(comparisonHeaders, comparisonRows));
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Pricing Test Completed Successfully');
  console.log('='.repeat(70) + '\n');

  process.exit(0);
}

testPricing().catch((err) => {
  console.error('❌ Test failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
