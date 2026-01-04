import { loadConfig } from '../../config.js';
import { createConnection } from '../utils.js';
import {
  calculatePumpFunBuyPrice,
  calculatePriceImpact,
} from '../pumpfun/pricing.js';
import {
  getTokenMint,
  setupPayer,
  printHeader,
  printFooter,
  logError,
  handleTestError,
} from '../../utils/testHelpers.js';

interface SimulationResult {
  tokenAmount: bigint;
  outputTokens: number;
  solCost: number;
  usdCost: number;
  pricePerToken: number;
  priceImpact: number | null;
  success: boolean;
  error?: string;
}

async function simulateBuyForAmount(
  mintStr: string,
  tokenAmount: bigint,
  solPriceUsd: number
): Promise<SimulationResult> {
  try {
    // Calculate buy price
    const priceResult = await calculatePumpFunBuyPrice(mintStr, Number(tokenAmount), solPriceUsd);
    
    if (!priceResult) {
      return {
        tokenAmount,
        outputTokens: Number(tokenAmount),
        solCost: 0,
        usdCost: 0,
        pricePerToken: 0,
        priceImpact: null,
        success: false,
        error: 'Failed to calculate buy price',
      };
    }

    // Calculate price impact
    const priceImpact = await calculatePriceImpact(mintStr, tokenAmount, true);

    return {
      tokenAmount,
      outputTokens: Number(tokenAmount),
      solCost: priceResult.totalSol,
      usdCost: priceResult.totalUsd,
      pricePerToken: priceResult.solPerToken,
      priceImpact,
      success: true,
    };
  } catch (error) {
    return {
      tokenAmount,
      outputTokens: Number(tokenAmount),
      solCost: 0,
      usdCost: 0,
      pricePerToken: 0,
      priceImpact: null,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function displaySimulationResults(results: SimulationResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('📊 BUY SIMULATION RESULTS');
  console.log('='.repeat(100) + '\n');

  // Table header
  console.log(
    'Token Amount'.padEnd(18) +
    'Output Tokens'.padEnd(18) +
    'SOL Cost'.padEnd(15) +
    'USD Cost'.padEnd(15) +
    'Price/Token (SOL)'.padEnd(20) +
    'Price Impact %'.padEnd(18) +
    'Status'
  );
  console.log('-'.repeat(100));

  // Table rows
  results.forEach((result) => {
    const tokenAmountStr = (Number(result.tokenAmount)/1000000).toLocaleString().padEnd(18);
    const outputTokensStr = (Number(result.outputTokens)/1000000).toLocaleString().padEnd(18);
    const solCostStr = result.success
      ? `${result.solCost.toFixed(9)}`.padEnd(15)
      : 'N/A'.padEnd(15);
    const usdCostStr = result.success
      ? `$${result.usdCost.toFixed(2)}`.padEnd(15)
      : 'N/A'.padEnd(15);
    const pricePerTokenStr = result.success
      ? `${result.pricePerToken.toExponential(6)}`.padEnd(20)
      : 'N/A'.padEnd(20);
    const priceImpactStr = result.priceImpact !== null
      ? `${result.priceImpact > 0 ? '+' : ''}${result.priceImpact.toFixed(4)}%`.padEnd(18)
      : 'N/A'.padEnd(18);
    const statusStr = result.success ? '✅ Success' : `❌ ${result.error || 'Failed'}`;

    console.log(
      tokenAmountStr +
      outputTokensStr +
      solCostStr +
      usdCostStr +
      pricePerTokenStr +
      priceImpactStr +
      statusStr
    );
  });

  console.log('-'.repeat(100) + '\n');

  // Summary statistics
  const successfulResults = results.filter((r) => r.success);
  if (successfulResults.length > 0) {
    console.log('📈 Summary Statistics:');
    console.log(`   Successful Simulations: ${successfulResults.length}/${results.length}`);
    
    const totalSolCost = successfulResults.reduce((sum, r) => sum + r.solCost, 0);
    const totalUsdCost = successfulResults.reduce((sum, r) => sum + r.usdCost, 0);
    const avgPriceImpact = successfulResults
      .filter((r) => r.priceImpact !== null)
      .reduce((sum, r) => sum + (r.priceImpact || 0), 0) / 
      successfulResults.filter((r) => r.priceImpact !== null).length;

    console.log(`   Total SOL Cost (all buys): ${totalSolCost.toFixed(9)} SOL`);
    console.log(`   Total USD Cost (all buys): $${totalUsdCost.toFixed(2)}`);
    
    if (!isNaN(avgPriceImpact)) {
      console.log(`   Average Price Impact: ${avgPriceImpact > 0 ? '+' : ''}${avgPriceImpact.toFixed(4)}%`);
    }

    // Price impact analysis
    const priceImpacts = successfulResults
      .map((r) => r.priceImpact)
      .filter((pi): pi is number => pi !== null);
    
    if (priceImpacts.length > 0) {
      const minImpact = Math.min(...priceImpacts);
      const maxImpact = Math.max(...priceImpacts);
      console.log(`   Min Price Impact: ${minImpact > 0 ? '+' : ''}${minImpact.toFixed(4)}%`);
      console.log(`   Max Price Impact: ${maxImpact > 0 ? '+' : ''}${maxImpact.toFixed(4)}%`);
    }

    console.log('');
  }
}

async function testBuySimulate() {
  const config = loadConfig();

  printHeader('🚀 ARBITRAGE BOT - TOKEN BUY SIMULATION (MULTIPLE AMOUNTS)');

  // Get token address
  const solanaMint = getTokenMint(config.SOLANA_TOKEN_MINT);
  console.log(`   Token Address: ${solanaMint}\n`);

  // Setup connection (payer not needed for simulation, but we'll create a dummy one)
  const connection = createConnection(config.SOLANA_RPC_HTTP_URL);
  const payer = await setupPayer(config.SOLANA_PRIVATE_KEY || '', connection);

  // Test parameters - multiple token amounts
  const tokenAmounts = [1000000, 10000000, 100000000, 1000000000, 10000000000, 100000000000, 1000000000000, 10000000000000, 100000000000000, 1000000000000000];
  const solPriceUsd = config.SOLANA_SOL_PRICE_USD;

  console.log('📊 Simulation Parameters:');
  console.log(`   Token Amounts: ${tokenAmounts.map(a => (Number(a)/1000000).toLocaleString()).join(', ')}`);
  console.log(`   SOL Price (USD): $${solPriceUsd}`);
  console.log(`   Token Mint: ${solanaMint}\n`);

  try {
    console.log('🔄 Running simulations for each token amount...\n');

    const results: SimulationResult[] = [];

    // Simulate buy for each token amount
    for (let i = 0; i < tokenAmounts.length; i++) {
      const tokenAmount = tokenAmounts[i];
      console.log(`   [${i + 1}/${tokenAmounts.length}] Simulating buy of ${tokenAmount.toLocaleString()} tokens...`);
      
      const result = await simulateBuyForAmount(solanaMint, BigInt(tokenAmount), solPriceUsd);
      results.push(result);

      if (result.success) {
        console.log(`      ✅ SOL Cost: ${result.solCost.toFixed(9)} SOL | Price Impact: ${result.priceImpact !== null ? (result.priceImpact > 0 ? '+' : '') + result.priceImpact.toFixed(4) + '%' : 'N/A'}`);
      } else {
        console.log(`      ❌ Failed: ${result.error || 'Unknown error'}`);
      }
    }

    // Display all results in a table
    displaySimulationResults(results);

    printFooter('✅ Token Buy Simulation Test Completed', true);

  } catch (error) {
    logError(error, 'Error during simulation');
    throw error;
  }

  process.exit(0);
}

testBuySimulate().catch(handleTestError);

