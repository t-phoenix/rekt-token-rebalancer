import { loadConfig } from '../../config.js';
import { PublicKey } from '@solana/web3.js';
import { createConnection } from '../utils.js';
import { PUMP_FUN_PROGRAM } from '../constants.js';
import {
  subscribeToTradeEvents,
  formatTradeEvent,
  type TradeEvent,
} from '../pumpfun/events.js';
import {
  printHeader,
  printFooter,
  logError,
  handleTestError,
} from '../../utils/testHelpers.js';

/**
 * Test trade event listener for Pump Fun on Solana mainnet
 */
async function testTradeEventListener() {
  const config = loadConfig();

  printHeader('🎧 ARBITRAGE BOT - TRADE EVENT LISTENER TEST');

  // Setup connection
  const connection = createConnection(config.SOLANA_RPC_HTTP_URL);
  console.log(`   RPC URL: ${config.SOLANA_RPC_HTTP_URL}`);
  console.log(`   Program: Pump Fun (${PUMP_FUN_PROGRAM.toBase58()})\n`);

  // Optional: Filter by specific mint if provided
  let filterMint: PublicKey | undefined;
  if (config.SOLANA_TOKEN_MINT) {
    filterMint = new PublicKey(config.SOLANA_TOKEN_MINT);
    console.log(`   Filtering by mint: ${filterMint.toBase58()}\n`);
  } else {
    console.log('   Listening to ALL Pump Fun trades (no mint filter)\n');
  }

  // Statistics tracking
  let eventCount = 0;
  let buyCount = 0;
  let sellCount = 0;
  const startTime = Date.now();

  // Event callback
  const handleTradeEvent = (event: TradeEvent, signature: string) => {
    eventCount++;
    
    if (event.isBuy) {
      buyCount++;
    } else {
      sellCount++;
    }

    // Calculate amounts
    const solAmount = Number(event.solAmount) / 1e9; // Convert lamports to SOL
    const tokenAmount = Number(event.tokenAmount) / 1e6; // Convert to token amount (assuming 6 decimals)
    const tradeType = event.isBuy ? '🟢 BUY' : '🔴 SELL';
    
    // Display core trade information
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 ${tradeType} Event #${eventCount} - ${event.ixName.toUpperCase()}`);
    console.log(`${'='.repeat(80)}`);
    
    // Transaction hash (full)
    console.log(`\n🔗 Transaction Hash:`);
    console.log(`   ${signature}`);
    console.log(`   https://solscan.io/tx/${signature}`);
    
    // From/To addresses
    console.log(`\n👤 Addresses:`);
    console.log(`   From: ${event.user.toBase58()}`);
    if (event.isBuy) {
      console.log(`   To:   Bonding Curve (receiving tokens)`);
    } else {
      console.log(`   To:   Bonding Curve (receiving tokens back)`);
    }
    console.log(`   Token Mint: ${event.mint.toBase58()}`);
    
    // Amounts
    console.log(`\n💰 Amounts:`);
    if (event.isBuy) {
      console.log(`   SOL Spent:    ${solAmount.toFixed(6)} SOL`);
      console.log(`   Tokens Received: ${tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens`);
    } else {
      console.log(`   Tokens Sold:  ${tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens`);
      console.log(`   SOL Received: ${solAmount.toFixed(6)} SOL`);
    }
    console.log(`   Price:        ${(solAmount / tokenAmount).toFixed(8)} SOL per token`);
    
    // Fees
    console.log(`\n💸 Fees:`);
    console.log(`   Protocol Fee: ${(Number(event.fee) / 1e9).toLocaleString()} SOL`);
    console.log(`   Creator Fee:  ${(Number(event.creatorFee) / 1e9).toLocaleString()} SOL`);
    
    // Reserves (current state after this trade)
    console.log(`\n📊 Reserves (after trade):`);
    console.log(`   Virtual SOL:    ${(Number(event.virtualSolReserves) / 1e9).toLocaleString()} SOL`);
    console.log(`   Virtual Tokens: ${(Number(event.virtualTokenReserves) / 1e6).toLocaleString()} tokens`);
    console.log(`   Real SOL:       ${(Number(event.realSolReserves) / 1e9).toLocaleString()} SOL`);
    console.log(`   Real Tokens:    ${(Number(event.realTokenReserves) / 1e6).toLocaleString()} tokens`);
    
    // Timestamp
    console.log(`\n⏰ Timestamp: ${new Date(Number(event.timestamp) * 1000).toISOString()}`);
    
    // Statistics
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = eventCount / elapsed;
    console.log(`\n📈 Session Stats: ${eventCount} events | ${buyCount} buys | ${sellCount} sells | ${rate.toFixed(2)} events/sec`);
    console.log(`${'='.repeat(80)}\n`);
  };

  try {
    console.log('🔌 Subscribing to trade events...\n');
    console.log('⏳ Waiting for trade events... (Press Ctrl+C to stop)\n');

    // Subscribe to trade events
    const subscription = subscribeToTradeEvents(
      connection,
      handleTradeEvent,
      filterMint
    );

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n\n🛑 Shutting down...');
      subscription.unsubscribe();
      console.log(`\n📊 Final Statistics:`);
      console.log(`   Total Events: ${eventCount}`);
      console.log(`   Buys: ${buyCount}`);
      console.log(`   Sells: ${sellCount}`);
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`   Duration: ${elapsed.toFixed(1)}s`);
      if (elapsed > 0) {
        console.log(`   Rate: ${(eventCount / elapsed).toFixed(2)} events/sec`);
      }
      printFooter('✅ Trade Event Listener Test Completed');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process alive
    console.log('✅ Subscription active. Listening for events...\n');
    
  } catch (error) {
    logError(error, 'Error setting up trade event listener');
    throw error;
  }
}

testTradeEventListener().catch(handleTestError);

