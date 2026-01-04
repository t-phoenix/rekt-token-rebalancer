import { loadConfig } from '../../config.js';
import { createBaseProvider } from '../baseBalanceUtils.js';
import {
  subscribeToSwapEvents,
  getPairAddress,
  formatSwapEvent,
  SwapEvent,
} from '../uniswap/events.js';
import { createReadlineInterface } from '../../utils/cliUtils.js';

async function testSwapEvents() {
  const config = loadConfig();
  const rl = createReadlineInterface();

  console.log('\n' + '='.repeat(70));
  console.log('📡 BASE UNISWAP SWAP EVENTS LISTENER TEST');
  console.log('='.repeat(70) + '\n');

  // Validate required configuration
  if (!config.BASE_RPC_HTTP_URL) {
    throw new Error('Missing BASE_RPC_HTTP_URL in environment variables');
  }

  if (!config.UNISWAP_V2_ROUTER02_ADDRESS) {
    throw new Error('Missing UNISWAP_V2_ROUTER02_ADDRESS in environment variables');
  }

  if (!config.BASE_USDC_ADDRESS) {
    throw new Error('Missing BASE_USDC_ADDRESS in environment variables');
  }

  if (!config.BASE_TOKEN_ADDRESS) {
    throw new Error('Missing BASE_TOKEN_ADDRESS in environment variables');
  }

  // Create provider
  const provider = createBaseProvider(config.BASE_RPC_HTTP_URL);

  console.log('📋 Configuration:');
  console.log(`   Base RPC URL:           ${config.BASE_RPC_HTTP_URL}`);
  console.log(`   Router Address:         ${config.UNISWAP_V2_ROUTER02_ADDRESS}`);
  console.log(`   USDC Address:           ${config.BASE_USDC_ADDRESS}`);
  console.log(`   Token Address:          ${config.BASE_TOKEN_ADDRESS}\n`);

  try {
    // Get pair address
    console.log('🔍 Finding Uniswap V2 Pair...\n');
    const pairAddress = await getPairAddress(
      provider,
      config.UNISWAP_V2_ROUTER02_ADDRESS,
      config.BASE_USDC_ADDRESS,
      config.BASE_TOKEN_ADDRESS
    );

    console.log(`   ✅ Pair Address:        ${pairAddress}\n`);

    // Determine token order (Uniswap pairs have token0 < token1)
    const token0Address =
      config.BASE_USDC_ADDRESS.toLowerCase() < config.BASE_TOKEN_ADDRESS.toLowerCase()
        ? config.BASE_USDC_ADDRESS
        : config.BASE_TOKEN_ADDRESS;
    const token1Address =
      config.BASE_USDC_ADDRESS.toLowerCase() < config.BASE_TOKEN_ADDRESS.toLowerCase()
        ? config.BASE_TOKEN_ADDRESS
        : config.BASE_USDC_ADDRESS;

    console.log(`   Token0:                 ${token0Address}`);
    console.log(`   Token1:                 ${token1Address}\n`);

    // Statistics
    let eventCount = 0;
    let buyCount = 0;
    let sellCount = 0;
    const startTime = Date.now();

    // Event callback
    const handleSwapEvent = async (event: SwapEvent) => {
      eventCount++;
      
      // Determine if it's a buy or sell based on which token is being swapped in
      const isToken0In = event.amount0In > 0n;
      const isToken1In = event.amount1In > 0n;
      
      // For USDC/Token pair, if USDC is going in (and token out), it's a buy
      // If token is going in (and USDC out), it's a sell
      const isBuy = 
        (token0Address.toLowerCase() === config.BASE_USDC_ADDRESS.toLowerCase() && isToken0In) ||
        (token1Address.toLowerCase() === config.BASE_USDC_ADDRESS.toLowerCase() && isToken1In);
      
      if (isBuy) {
        buyCount++;
      } else {
        sellCount++;
      }

      // Format and display the event
      const formatted = await formatSwapEvent(
        provider,
        event,
        token0Address,
        token1Address
      );

      const direction = isBuy ? '🟢 BUY' : '🔴 SELL';
      console.log(`\n${direction} #${eventCount}`);
      console.log(`   ${formatted}`);
      console.log(`   Stats: ${buyCount} buys, ${sellCount} sells (Total: ${eventCount})`);
    };

    // Start listening to events
    console.log('🎧 Starting Swap Event Listener...\n');
    console.log('   Press Ctrl+C to stop\n');

    // Use polling mode by default for better compatibility
    // Set to false if your RPC provider supports WebSocket subscriptions
    const usePolling = true;
    const pollInterval = 2000; // 2 seconds

    const subscription = subscribeToSwapEvents(
      provider,
      pairAddress,
      token0Address,
      token1Address,
      handleSwapEvent,
      pollInterval,
      usePolling
    );

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n\n🛑 Stopping event listener...\n');
      subscription.unsubscribe();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('📊 Final Statistics:');
      console.log('   ' + '-'.repeat(66));
      console.log(`   Total Events:           ${eventCount}`);
      console.log(`   Buy Events:            ${buyCount}`);
      console.log(`   Sell Events:            ${sellCount}`);
      console.log(`   Duration:               ${duration}s`);
      console.log('   ' + '-'.repeat(66) + '\n');
      
      console.log('='.repeat(70));
      console.log('✅ Event Listener Stopped');
      console.log('='.repeat(70) + '\n');
      
      rl.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process alive
    console.log('   Listening for swap events...\n');
  } catch (err) {
    rl.close();
    console.error('❌ Failed to start event listener:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error('\nStack trace:', err.stack);
    }
    throw err;
  }
}

testSwapEvents().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

