import 'dotenv/config';
import { loadConfig } from './config.js';
import { createConnection } from './solana/utils.js';
import { createBaseProvider } from './base/baseBalanceUtils.js';
import { runArbitrageAnalysis } from './arbitrageHandler.js';
import { createReadlineInterface, promptConfirmation } from './utils/cliUtils.js';
import { printHeader, printFooter, logError, handleTestError } from './utils/testHelpers.js';

/**
 * Main arbitrage bot entry point - CLI mode with user confirmation
 */
async function main() {
  const config = loadConfig();
  const rl = createReadlineInterface();

  printHeader('🚀 ARBITRAGE BOT - MARKET ANALYSIS & TRADE SIMULATION');

  try {
    // Validate configuration
    if (!config.SOLANA_TOKEN_MINT) {
      throw new Error('SOLANA_TOKEN_MINT is required');
    }
    if (!config.BASE_TOKEN_ADDRESS) {
      throw new Error('BASE_TOKEN_ADDRESS is required');
    }
    if (!config.BASE_USDC_ADDRESS) {
      throw new Error('BASE_USDC_ADDRESS is required');
    }

    console.log('📋 Configuration:');
    console.log(`   Solana Token: ${config.SOLANA_TOKEN_MINT}`);
    console.log(`   Base Token: ${config.BASE_TOKEN_ADDRESS}`);
    console.log(`   Base USDC: ${config.BASE_USDC_ADDRESS}`);
    console.log(`   Min Profit Threshold: ${(config.MIN_PROFIT_THRESHOLD * 100).toFixed(2)}%`);
    console.log(`   Max Trade Size: $${config.TRADE_SIZE_USD}\n`);

    // Setup connections
    console.log('🔧 Setting up connections...');
    const solanaConnection = createConnection(config.SOLANA_RPC_HTTP_URL);
    const baseProvider = createBaseProvider(config.BASE_RPC_HTTP_URL);
    console.log('');

    // Run analysis (without auto-execution for CLI mode)
    const result = await runArbitrageAnalysis(
      config,
      solanaConnection,
      baseProvider,
      false  // Disable auto-execution for CLI mode
    );

    if (!result) {
      console.log('❌ No profitable arbitrage opportunity found.\n');
      printFooter('✅ Analysis Complete');
      rl.close();
      process.exit(0);
    }

    const { opportunity, simulation } = result;

    // Ask for user confirmation
    console.log('\n' + '='.repeat(80));
    console.log('⚠️  READY TO EXECUTE ARBITRAGE TRADE');
    console.log('='.repeat(80));
    const confirmed = await promptConfirmation(
      rl,
      '\n   Do you want to execute this trade? (yes/no): '
    );

    if (!confirmed) {
      console.log('\n❌ Trade cancelled by user\n');
      printFooter('✅ Analysis Complete');
      rl.close();
      process.exit(0);
    }

    // Execute with auto-execution enabled
    console.log('\n📤 Executing trades...\n');
    await runArbitrageAnalysis(
      config,
      solanaConnection,
      baseProvider,
      true  // Enable auto-execution
    );

    printFooter('✅ Arbitrage Trade Executed Successfully');

  } catch (error) {
    logError(error, 'Error in arbitrage bot');
    rl.close();
    throw error;
  }

  rl.close();
  process.exit(0);
}

// Run the bot
main().catch(handleTestError);
