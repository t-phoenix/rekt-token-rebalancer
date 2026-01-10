import 'dotenv/config';
import { JsonRpcProvider, Wallet } from 'ethers';
import { PriceFetcher } from './utils/priceFetcher.js';
import { getUserConfig } from './utils/baseVolumeBotConfig.js';
import { executeBuyTrade, executeSellTrade, getRandomTradeSize, shouldBuy } from './base/volumebot/volumeBotTrading.js';
import { VolumeTracker, getWalletBalances } from './base/volumebot/volumeBotTracking.js';
import { displayConfig, displaySummary, displayTradeHistory } from './base/volumebot/volumeBotDisplay.js';

// ============================================================================
// MAIN BOT LOGIC
// ============================================================================

async function runVolumeBot() {
    console.clear();

    // 1. GET CONFIGURATION
    const config = await getUserConfig();

    // 2. INITIALIZE ETH PRICE FETCHER
    let ethPriceUsd = 3000; // Default fallback
    let priceFetcher: PriceFetcher | null = null;
    let lastPriceFetchTime = 0; // Track price fetch separately from summary

    const cmcApiKey = process.env.COINMARKETCAP_API_KEY;
    if (cmcApiKey) {
        try {
            priceFetcher = new PriceFetcher(cmcApiKey);
            ethPriceUsd = await priceFetcher.getEthPrice();
            lastPriceFetchTime = Date.now(); // Initialize price fetch time
            console.log(`💰 Fetched live ETH price: $${ethPriceUsd.toFixed(2)}\n`);
        } catch (error) {
            console.warn(`⚠️  Failed to fetch ETH price: ${error instanceof Error ? error.message : String(error)}`);
            console.warn(`   Using fallback price: $${ethPriceUsd}\n`);
        }
    } else {
        console.warn('⚠️  COINMARKETCAP_API_KEY not set, using default ETH price: $3000\n');
    }

    // 3. INITIALIZE PROVIDER AND WALLET
    const provider = new JsonRpcProvider(config.rpcUrl);
    const wallet = new Wallet(config.privateKey, provider);

    // Display configuration
    displayConfig(config, ethPriceUsd, priceFetcher);

    // 4. INITIALIZE TRACKING
    const tracker = new VolumeTracker();

    // Get initial balances
    const initialBalances = await getWalletBalances(
        provider,
        wallet.address,
        config.tokenAddress,
        config.usdcAddress
    );
    tracker.setInitialBalances(initialBalances.eth, initialBalances.usdc, initialBalances.token);

    console.log('💼 Initial Wallet State:');
    console.log(`   ETH: ${initialBalances.eth.toFixed(6)}`);
    console.log(`   USDC: ${initialBalances.usdc.toFixed(2)}`);
    console.log(`   Tokens: ${initialBalances.token.toFixed(2)}`);
    console.log(`   💵 Current ETH Price: $${ethPriceUsd.toFixed(2)} ${priceFetcher ? '(live, updates every 5min)' : '(static)'}\n`);

    // 5. SET UP TRADING PARAMETERS
    const startTime = Date.now();
    const stopTime = config.runDurationMinutes > 0
        ? startTime + (config.runDurationMinutes * 60 * 1000)
        : null;

    let lastSummaryTime = Date.now();

    console.log('🚀 Starting Base volume bot...\n');
    console.log('Press Ctrl+C to stop.\n');

    // 6. MAIN TRADING LOOP
    let isRunning = true;
    let totalVolumeUsd = 0;

    const tradingLoop = async () => {
        while (isRunning) {
            try {
                // Check stop conditions
                if (stopTime && Date.now() >= stopTime) {
                    console.log('\n⏰ Run duration reached. Stopping bot...');
                    isRunning = false;
                    break;
                }

                if (config.maxTotalVolumeUsd > 0 && totalVolumeUsd >= config.maxTotalVolumeUsd) {
                    console.log('\n💰 Max volume reached. Stopping bot...');
                    isRunning = false;
                    break;
                }

                // Update ETH price periodically (every 5 minutes)
                if (priceFetcher && Date.now() - lastPriceFetchTime >= 300000) {
                    try {
                        const newEthPrice = await priceFetcher.getEthPrice();
                        if (newEthPrice !== ethPriceUsd) {
                            console.log(`\n🔄 ETH price updated: $${ethPriceUsd.toFixed(2)} → $${newEthPrice.toFixed(2)}`);
                            ethPriceUsd = newEthPrice;
                        }
                        lastPriceFetchTime = Date.now(); // Update price fetch time
                    } catch {
                        // Keep using last known price
                    }
                }

                // Determine trade direction
                const isBuy = shouldBuy(config.buyProbability);

                // Get current balances
                const currentBalances = await getWalletBalances(
                    provider,
                    wallet.address,
                    config.tokenAddress,
                    config.usdcAddress
                );

                // Execute trade
                let trade;

                if (isBuy) {
                    const tradeSize = getRandomTradeSize(
                        config.minTradeAmountUsdc,
                        config.maxTradeAmountUsdc,
                        config.randomizeTradeSize
                    );

                    // Check if we have enough USDC
                    if (currentBalances.usdc < tradeSize) {
                        console.log('⚠️  Insufficient USDC balance for buy trade. Skipping...');
                        await new Promise(resolve => setTimeout(resolve, config.tradingIntervalMs));
                        continue;
                    }

                    trade = await executeBuyTrade(
                        provider,
                        wallet,
                        config.routerAddress,
                        config.usdcAddress,
                        config.tokenAddress,
                        tradeSize,
                        config.slippageBps,
                        config.deadlineSeconds
                    );
                } else {
                    // Sell a random percentage of token balance (10-50%)
                    const sellPercentage = 0.1 + Math.random() * 0.4;
                    const tokenAmount = currentBalances.token * sellPercentage;

                    // Check if we have enough tokens
                    if (currentBalances.token < 1) {
                        console.log('⚠️  Insufficient token balance for sell trade. Switching to buy...');

                        const tradeSize = getRandomTradeSize(
                            config.minTradeAmountUsdc,
                            config.maxTradeAmountUsdc,
                            config.randomizeTradeSize
                        );

                        trade = await executeBuyTrade(
                            provider,
                            wallet,
                            config.routerAddress,
                            config.usdcAddress,
                            config.tokenAddress,
                            tradeSize,
                            config.slippageBps,
                            config.deadlineSeconds
                        );
                    } else {
                        trade = await executeSellTrade(
                            provider,
                            wallet,
                            config.routerAddress,
                            config.usdcAddress,
                            config.tokenAddress,
                            tokenAmount,
                            config.slippageBps,
                            config.deadlineSeconds
                        );
                    }
                }

                // Record trade
                tracker.addTrade(trade);

                if (trade.success) {
                    totalVolumeUsd += trade.usdValue;
                }

                // Display summary if interval reached
                if (Date.now() - lastSummaryTime >= config.summaryIntervalMs) {
                    const currentBalances = await getWalletBalances(
                        provider,
                        wallet.address,
                        config.tokenAddress,
                        config.usdcAddress
                    );
                    const pnl = tracker.calculatePnL(
                        currentBalances.eth,
                        currentBalances.usdc,
                        currentBalances.token,
                        ethPriceUsd
                    );

                    displaySummary(pnl);
                    displayTradeHistory(tracker.getTrades(), 5);

                    lastSummaryTime = Date.now();
                }

                // Wait for next trade
                await new Promise(resolve => setTimeout(resolve, config.tradingIntervalMs));
            } catch (error) {
                console.error('Error in trading loop:', error);
                await new Promise(resolve => setTimeout(resolve, config.tradingIntervalMs));
            }
        }
    };

    // 7. HANDLE GRACEFUL SHUTDOWN
    process.on('SIGINT', async () => {
        console.log('\n\n⏹️  Stopping bot...');
        isRunning = false;

        // Display final summary
        const finalBalances = await getWalletBalances(
            provider,
            wallet.address,
            config.tokenAddress,
            config.usdcAddress
        );
        const finalPnl = tracker.calculatePnL(
            finalBalances.eth,
            finalBalances.usdc,
            finalBalances.token,
            ethPriceUsd
        );

        console.log('\n╔════════════════════════════════════════════════════════════╗');
        console.log('║                    FINAL SUMMARY                           ║');
        console.log('╚════════════════════════════════════════════════════════════╝');

        displaySummary(finalPnl);
        displayTradeHistory(tracker.getTrades(), 10);

        console.log('👋 Bot stopped. Goodbye!\n');
        process.exit(0);
    });

    // 8. START TRADING
    await tradingLoop();

    // Display final summary if bot stops naturally
    const finalBalances = await getWalletBalances(
        provider,
        wallet.address,
        config.tokenAddress,
        config.usdcAddress
    );
    const finalPnl = tracker.calculatePnL(
        finalBalances.eth,
        finalBalances.usdc,
        finalBalances.token,
        ethPriceUsd
    );

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    FINAL SUMMARY                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    displaySummary(finalPnl);
    displayTradeHistory(tracker.getTrades(), 10);

    console.log('✅ Bot completed successfully!\n');
}

// ============================================================================
// ENTRY POINT
// ============================================================================

runVolumeBot().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
