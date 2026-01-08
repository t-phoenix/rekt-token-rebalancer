/**
 * Arbitrage Handler
 * 
 * Extracted arbitrage logic from main.ts to be callable programmatically
 * by the event-driven server or run standalone via CLI.
 */

import { Connection, Keypair } from '@solana/web3.js';
import { JsonRpcProvider, Wallet } from 'ethers';
import { getKeyPairFromPrivateKey } from './solana/utils.js';
import { fetchMarketData } from './arbitrage/marketFetcher.js';
import { fetchWalletStats } from './arbitrage/walletStats.js';
import { analyzeOpportunity } from './arbitrage/opportunityAnalyzer.js';
import { simulateArbitrage } from './arbitrage/simulator.js';
import { executeArbitrage } from './arbitrage/executor.js';
import { displayMarketStats, displayWalletStats, displayOpportunity, displaySimulationResults } from './arbitrage/display.js';
import { initializePriceFetcher, PriceFetcher } from './utils/priceFetcher.js';
import { getNotificationService } from './monitoring/notifications.js';
import type { AppConfig } from './config.js';

/**
 * Run arbitrage analysis and optionally execute trades
 * 
 * @param config - Application configuration
 * @param solanaConnection - Solana RPC connection
 * @param baseProvider - Base chain RPC provider
 * @param autoExecute - Whether to automatically execute profitable trades (default: from config)
 * @param priceFetcher - Optional shared PriceFetcher instance for live pricing (if not provided, creates one if API key is configured)
 * @returns Execution result or null if no opportunity found
 */
export async function runArbitrageAnalysis(
    config: AppConfig,
    solanaConnection: Connection,
    baseProvider: JsonRpcProvider,
    autoExecute?: boolean,
    priceFetcher?: PriceFetcher | null
): Promise<any> {

    const shouldAutoExecute = autoExecute ?? config.AUTO_EXECUTE_TRADES;
    const notificationService = getNotificationService(true);

    try {
        // Setup wallets
        let solanaKeypair: Keypair | null = null;
        let baseWallet: Wallet | null = null;

        if (config.SOLANA_PRIVATE_KEY) {
            solanaKeypair = getKeyPairFromPrivateKey(config.SOLANA_PRIVATE_KEY);
        }

        if (config.BASE_PRIVATE_KEY_HEX) {
            baseWallet = new Wallet(config.BASE_PRIVATE_KEY_HEX, baseProvider);
        }

        // Initialize price fetcher if not provided and API key is available
        if (!priceFetcher && config.COINMARKETCAP_API_KEY) {
            try {
                priceFetcher = initializePriceFetcher(config.COINMARKETCAP_API_KEY);
            } catch (error) {
                console.warn('⚠️  Failed to initialize price fetcher:', error);
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
            return null;
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
            return null;
        }

        // Display simulation results
        displaySimulationResults(simulation, config);

        // Execute if auto-execute is enabled
        if (shouldAutoExecute) {
            if (!solanaKeypair || !baseWallet) {
                console.warn('⚠️  Auto-execution enabled but private keys not configured\n');
                return { opportunity, simulation, executed: false };
            }

            console.log('\n📤 Auto-executing trades...\n');

            const startTime = Date.now();
            const preTradeWalletBalances = walletStats ? {
                solana: { ...walletStats.solana },
                base: { ...walletStats.base }
            } : {
                solana: { sol: 0, token: 0, solUsd: 0, tokenUsd: 0, totalUsd: 0 },
                base: { eth: 0, usdc: 0, token: 0, ethUsd: 0, totalUsd: 0 }
            };

            try {
                const result = await executeArbitrage(
                    config,
                    opportunity,
                    simulation,
                    solanaConnection,
                    baseProvider,
                    solanaKeypair,
                    baseWallet
                );

                const executionDurationMs = Date.now() - startTime;

                // Fetch post-trade balances
                const postTradeWalletStats = await fetchWalletStats(
                    config,
                    solanaConnection,
                    baseProvider,
                    solanaKeypair,
                    baseWallet,
                    marketStats
                );

                // Send notification
                await notificationService.notifyTradeExecution({
                    opportunity,
                    simulation,
                    solanaSignature: undefined, // Will be populated based on direction
                    baseTransactionHash: undefined, // Will be populated based on direction
                    preTradeMarketStats: marketStats,
                    preTradeWalletBalances,
                    postTradeWalletBalances: postTradeWalletStats ? {
                        solana: { ...postTradeWalletStats.solana },
                        base: { ...postTradeWalletStats.base }
                    } : undefined,
                    timestamp: Date.now(),
                    executionDurationMs
                });

                return { opportunity, simulation, result, executed: true };
            } catch (error: any) {
                await notificationService.notifyTradeFailed(
                    opportunity,
                    'Execution failed',
                    error
                );
                throw error;
            }
        } else {
            console.log('\n⏸️  Auto-execution disabled. Opportunity found but not executed.\n');
            return { opportunity, simulation, executed: false };
        }

    } catch (error) {
        console.error('❌ Error in arbitrage analysis:', error);
        throw error;
    }
}
