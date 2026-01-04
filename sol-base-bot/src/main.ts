import 'dotenv/config';
import { loadConfig } from './config.js';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { JsonRpcProvider, Wallet } from 'ethers';
import { createConnection, getKeyPairFromPrivateKey } from './solana/utils.js';
import { createBaseProvider } from './base/baseBalanceUtils.js';
import { createReadlineInterface, promptConfirmation } from './utils/cliUtils.js';
import { printHeader, printFooter, logError, handleTestError } from './utils/testHelpers.js';
import { fetchMarketData } from './arbitrage/marketFetcher.js';
import { fetchWalletStats } from './arbitrage/walletStats.js';
import { analyzeOpportunity } from './arbitrage/opportunityAnalyzer.js';
import { simulateArbitrage } from './arbitrage/simulator.js';
import { executeArbitrage } from './arbitrage/executor.js';
import { displayMarketStats, displayWalletStats, displayOpportunity, displaySimulationResults } from './arbitrage/display.js';
import { initializePriceFetcher } from './utils/priceFetcher.js';
import type { Opportunity, ArbitrageSimulation } from './arbitrage/types.js';


/**
 * Main arbitrage bot entry point
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

    // Setup connections and wallets
    console.log('🔧 Setting up connections...');
    const solanaConnection = createConnection(config.SOLANA_RPC_HTTP_URL);
    const baseProvider = createBaseProvider(config.BASE_RPC_HTTP_URL);

    let solanaKeypair: Keypair | null = null;
    let baseWallet: Wallet | null = null;

    if (config.SOLANA_PRIVATE_KEY) {
      solanaKeypair = getKeyPairFromPrivateKey(config.SOLANA_PRIVATE_KEY);
      console.log(`   Solana Wallet: ${solanaKeypair.publicKey.toBase58()}`);
    }

    if (config.BASE_PRIVATE_KEY_HEX) {
      baseWallet = new Wallet(config.BASE_PRIVATE_KEY_HEX, baseProvider);
      console.log(`   Base Wallet: ${baseWallet.address}`);
    }

    console.log('');

    // Initialize price fetcher if API key is provided
    if (config.COINMARKETCAP_API_KEY) {
      try {
        initializePriceFetcher(config.COINMARKETCAP_API_KEY);
        console.log('✅ Price fetcher initialized (CoinMarketCap)\n');
      } catch (error) {
        console.warn('⚠️  Failed to initialize price fetcher:', error);
        console.warn('   Using fallback prices from config\n');
      }
    }

    // Fetch market data
    console.log('📊 Fetching market data from both chains...\n');
    const marketStats = await fetchMarketData(
      config,
      solanaConnection,
      baseProvider,
      solanaKeypair
    );

    if (!marketStats) {
      throw new Error('Failed to fetch market data');
    }

    // Display market stats
    displayMarketStats(marketStats, config);

    // Fetch wallet balances
    console.log('\n💰 Fetching wallet balances...\n');
    const walletStats = await fetchWalletStats(
      config,
      solanaConnection,
      baseProvider,
      solanaKeypair,
      baseWallet,
      marketStats
    );

    if (!walletStats) {
      console.warn('⚠️  Could not fetch wallet balances. Continuing with simulation...\n');
    } else {
      displayWalletStats(walletStats, marketStats);
    }

    // Analyze arbitrage opportunity
    console.log('\n🔍 Analyzing arbitrage opportunity...\n');
    const opportunity = await analyzeOpportunity(
      config,
      marketStats,
      walletStats,
      baseProvider
    );

    if (!opportunity) {
      console.log('❌ No profitable arbitrage opportunity found.\n');
      printFooter('✅ Analysis Complete');
      rl.close();
      process.exit(0);
    }

    // Display opportunity
    displayOpportunity(opportunity, config, marketStats);

    // Simulate transactions
    console.log('\n🧪 Simulating transactions on both chains...\n');
    const simulation = await simulateArbitrage(
      config,
      opportunity,
      solanaConnection,
      baseProvider,
      solanaKeypair,
      baseWallet
    );

    if (!simulation || !simulation.success) {
      console.log('❌ Simulation failed or not profitable.\n');
      if (simulation?.failureReason) {
        console.log(`   Reason: ${simulation.failureReason}\n`);
      }
      printFooter('✅ Analysis Complete');
      rl.close();
      process.exit(0);
    }

    // Display simulation results
    displaySimulationResults(simulation, config);

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

    // Execute trades
    if (!solanaKeypair || !baseWallet) {
      throw new Error('Private keys required to execute trades');
    }

    console.log('\n📤 Executing trades...\n');
    await executeArbitrage(
      config,
      opportunity,
      simulation,
      solanaConnection,
      baseProvider,
      solanaKeypair,
      baseWallet
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
