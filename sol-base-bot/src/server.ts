/**
 * Arbitrage Bot Server
 * 
 * Event-driven backend server that monitors swap/trade events on Pump.fun and Uniswap,
 * and triggers arbitrage analysis when price movements exceed configured thresholds.
 */

import 'dotenv/config';
import express from 'express';
import { loadConfig } from './config.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { createConnection } from './solana/utils.js';
import { createBaseProvider } from './base/baseBalanceUtils.js';
import { EventCoordinator } from './monitoring/eventCoordinator.js';
import { runArbitrageAnalysis } from './arbitrageHandler.js';
import { initializePriceFetcher, PriceFetcher } from './utils/priceFetcher.js';
import type { PriceChangeEvent } from './monitoring/priceTracker.js';

const app = express();

let eventCoordinator: EventCoordinator | null = null;
let priceFetcher: PriceFetcher | null = null;
let priceRefreshInterval: NodeJS.Timeout | null = null;
let isStarted = false;

/**
 * Initialize and start the event monitoring system
 */
async function startMonitoring() {
    if (isStarted) {
        console.log('⚠️  Monitoring already started');
        return;
    }

    const config = loadConfig();

    console.log('\n' + '='.repeat(100));
    console.log('🤖 ARBITRAGE BOT - EVENT-DRIVEN MODE');
    console.log('='.repeat(100));
    console.log('\n📋 Configuration:');
    console.log(`   Solana Token: ${config.SOLANA_TOKEN_MINT}`);
    console.log(`   Base Token: ${config.BASE_TOKEN_ADDRESS}`);
    console.log(`   Price Movement Threshold: ${config.PRICE_MOVEMENT_THRESHOLD}%`);
    console.log(`   Auto Execute: ${config.AUTO_EXECUTE_TRADES ? 'Yes' : 'No'}`);
    console.log(`   Analysis Cooldown: ${config.ANALYSIS_COOLDOWN_MS / 1000}s`);
    console.log('');

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
    if (!config.UNISWAP_V2_ROUTER02_ADDRESS) {
        throw new Error('UNISWAP_V2_ROUTER02_ADDRESS is required');
    }

    // Setup connections
    console.log('🔧 Setting up blockchain connections...\n');
    const solanaConnection = createConnection(config.SOLANA_RPC_HTTP_URL);
    const baseProvider = createBaseProvider(config.BASE_RPC_HTTP_URL);

    // Initialize event coordinator
    eventCoordinator = new EventCoordinator(
        {
            solanaMint: new PublicKey(config.SOLANA_TOKEN_MINT),
            baseTokenAddress: config.BASE_TOKEN_ADDRESS,
            baseUsdcAddress: config.BASE_USDC_ADDRESS,
            baseRouterAddress: config.UNISWAP_V2_ROUTER02_ADDRESS,
            priceMovementThreshold: config.PRICE_MOVEMENT_THRESHOLD,
            solanaEventPollInterval: config.EVENT_POLL_INTERVAL_MS,
            baseEventPollInterval: config.EVENT_POLL_INTERVAL_MS,
            analysisCooldownMs: config.ANALYSIS_COOLDOWN_MS,
            logAllEvents: config.LOG_ALL_EVENTS,
        },
        solanaConnection,
        baseProvider
    );

    // Register arbitrage trigger callback
    eventCoordinator.onArbitrageTrigger(async (event: PriceChangeEvent) => {
        try {
            await runArbitrageAnalysis(config, solanaConnection, baseProvider, undefined, priceFetcher);
        } catch (error) {
            console.error('❌ Error running arbitrage analysis:', error);
        }
    });

    // Initialize SOL price fetcher if API key is configured
    if (config.COINMARKETCAP_API_KEY) {
        try {
            priceFetcher = initializePriceFetcher(config.COINMARKETCAP_API_KEY);
            const initialPrice = await priceFetcher.getSolPrice();
            console.log(`💰 Initialized SOL price fetcher: $${initialPrice.toFixed(2)}`);

            // Set up periodic price refresh (every 5 minutes)
            priceRefreshInterval = setInterval(async () => {
                try {
                    const newPrice = await priceFetcher!.getSolPrice();
                    console.log(`🔄 SOL price refreshed: $${newPrice.toFixed(2)}`);
                } catch (error) {
                    console.warn('⚠️  Failed to refresh SOL price:', error);
                }
            }, 5 * 60 * 1000); // 5 minutes

            console.log('   🔄 Price auto-refresh: Every 5 minutes\n');
        } catch (error) {
            console.warn('⚠️  Failed to initialize price fetcher:', error);
            console.warn('   Continuing without live SOL pricing\n');
        }
    } else {
        console.warn('⚠️  COINMARKETCAP_API_KEY not configured');
        console.warn('   Arbitrage bot will use static pricing\n');
    }

    // Start monitoring
    await eventCoordinator.start();

    isStarted = true;
    console.log('✅ Server ready and monitoring events\n');
}

/**
 * Stop the event monitoring system
 */
function stopMonitoring() {
    if (!isStarted || !eventCoordinator) {
        console.log('⚠️  Monitoring not started');
        return;
    }

    // Stop event monitoring
    eventCoordinator.stop();
    eventCoordinator = null;

    // Clean up price refresh interval
    if (priceRefreshInterval) {
        clearInterval(priceRefreshInterval);
        priceRefreshInterval = null;
    }

    // Clean up price fetcher
    if (priceFetcher) {
        priceFetcher = null;
    }

    isStarted = false;
    console.log('✅ Monitoring stopped\n');
}

// API Routes

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        monitoring: isStarted,
        timestamp: new Date().toISOString()
    });
});

app.get('/stats', (req, res) => {
    if (!isStarted || !eventCoordinator) {
        return res.status(503).json({
            error: 'Monitoring not started'
        });
    }

    const stats = eventCoordinator.getStats();
    res.json({
        ...stats,
        timestamp: new Date().toISOString()
    });
});

app.post('/reset-baseline', (req, res) => {
    if (!isStarted || !eventCoordinator) {
        return res.status(503).json({
            error: 'Monitoring not started'
        });
    }

    eventCoordinator.resetPriceBaseline();
    res.json({
        message: 'Price baseline reset successfully',
        timestamp: new Date().toISOString()
    });
});

app.post('/trigger-analysis', async (req, res) => {
    if (!isStarted) {
        return res.status(503).json({
            error: 'Monitoring not started'
        });
    }

    const config = loadConfig();
    const solanaConnection = createConnection(config.SOLANA_RPC_HTTP_URL);
    const baseProvider = createBaseProvider(config.BASE_RPC_HTTP_URL);

    try {
        await runArbitrageAnalysis(config, solanaConnection, baseProvider, undefined, priceFetcher);
        res.json({
            message: 'Analysis triggered successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Analysis failed',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n📛 Received SIGINT, shutting down gracefully...');
    stopMonitoring();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n📛 Received SIGTERM, shutting down gracefully...');
    stopMonitoring();
    process.exit(0);
});

// Start server
const config = loadConfig();
const PORT = config.SERVER_PORT;

app.listen(PORT, async () => {
    console.log(`🚀 Server listening on port ${PORT}`);

    // Start monitoring
    try {
        await startMonitoring();
    } catch (error) {
        console.error('❌ Failed to start monitoring:', error);
        process.exit(1);
    }
});
