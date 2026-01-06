/**
 * Notification Service
 * 
 * Sends notifications about trade executions and system events.
 * Can be extended to support multiple notification channels (email, Slack, Telegram, etc.)
 */

import type { Opportunity, ArbitrageSimulation } from '../arbitrage/types.js';
import type { MarketStats } from '../arbitrage/marketFetcher.js';

export interface TradeExecutionSummary {
    // Trade details
    opportunity: Opportunity;
    simulation: ArbitrageSimulation;

    // Transaction results
    solanaSignature?: string;
    baseTransactionHash?: string;

    // Pre-trade state
    preTradeMarketStats: MarketStats;
    preTradeWalletBalances: {
        solana: { sol: number; token: number };
        base: { eth: number; usdc: number; token: number };
    };

    // Post-trade state (if available)
    postTradeWalletBalances?: {
        solana: { sol: number; token: number };
        base: { eth: number; usdc: number; token: number };
    };

    // Execution timing
    timestamp: number;
    executionDurationMs: number;
}

export class NotificationService {
    private readonly verbose: boolean;

    constructor(verbose: boolean = true) {
        this.verbose = verbose;
    }

    /**
     * Send notification about successful trade execution
     */
    async notifyTradeExecution(summary: TradeExecutionSummary): Promise<void> {
        console.log('\n' + '='.repeat(100));
        console.log('✅ TRADE EXECUTION NOTIFICATION');
        console.log('='.repeat(100));

        const { opportunity, simulation, preTradeMarketStats } = summary;

        // Trade Summary
        console.log('\n📊 TRADE SUMMARY:');
        console.log(`   Direction: ${opportunity.direction === 'SOLANA_TO_BASE' ? 'Buy Solana → Sell Base' : 'Buy Base → Sell Solana'}`);
        console.log(`   Trade Size (Solana): ${Number(opportunity.optimalTradeSize.solana.tokenAmount) / 1e6} tokens`);
        console.log(`   Trade Size (Base): ${Number(opportunity.optimalTradeSize.base.tokenAmount) / 1e6} tokens`);
        console.log(`   Expected Profit: $${simulation.netProfitUsd.toFixed(4)} (${simulation.netProfitPercent.toFixed(2)}%)`);
        console.log(`   Execution Time: ${summary.executionDurationMs}ms`);
        console.log(`   Timestamp: ${new Date(summary.timestamp).toISOString()}`);

        // Transaction Details
        console.log('\n🔗 TRANSACTION DETAILS:');
        if (summary.solanaSignature) {
            console.log(`   Solana TX: https://solscan.io/tx/${summary.solanaSignature}`);
        }
        if (summary.baseTransactionHash) {
            console.log(`   Base TX: https://basescan.org/tx/${summary.baseTransactionHash}`);
        }

        // Market State
        console.log('\n💹 PRE-TRADE MARKET STATE:');
        console.log(`   Solana Price: ${preTradeMarketStats.solana.priceUsd.toFixed(6)} USD/token`);
        console.log(`   Base Price: ${preTradeMarketStats.base.priceUsd.toFixed(6)} USD/token`);
        console.log(`   Price Difference: ${opportunity.priceDifferencePercent.toFixed(2)}%`);
        console.log(`   Solana Liquidity: $${preTradeMarketStats.solana.liquidityUsd.toFixed(2)}`);
        console.log(`   Base Liquidity: $${preTradeMarketStats.base.liquidityUsd.toFixed(2)}`);

        // Wallet Balances - Pre Trade
        console.log('\n💰 PRE-TRADE WALLET BALANCES:');
        this.printWalletBalances(summary.preTradeWalletBalances);

        // Wallet Balances - Post Trade (if available)
        if (summary.postTradeWalletBalances) {
            console.log('\n💰 POST-TRADE WALLET BALANCES:');
            this.printWalletBalances(summary.postTradeWalletBalances);

            // Calculate changes
            console.log('\n📈 BALANCE CHANGES:');
            const solDiff = summary.postTradeWalletBalances.solana.sol - summary.preTradeWalletBalances.solana.sol;
            const ethDiff = summary.postTradeWalletBalances.base.eth - summary.preTradeWalletBalances.base.eth;
            const usdcDiff = summary.postTradeWalletBalances.base.usdc - summary.preTradeWalletBalances.base.usdc;
            const solTokenDiff = summary.postTradeWalletBalances.solana.token - summary.preTradeWalletBalances.solana.token;
            const baseTokenDiff = summary.postTradeWalletBalances.base.token - summary.preTradeWalletBalances.base.token;

            console.log(`   SOL: ${solDiff >= 0 ? '+' : ''}${solDiff.toFixed(4)}`);
            console.log(`   ETH: ${ethDiff >= 0 ? '+' : ''}${ethDiff.toFixed(6)}`);
            console.log(`   USDC: ${usdcDiff >= 0 ? '+' : ''}${usdcDiff.toFixed(2)}`);
            console.log(`   Solana Tokens: ${solTokenDiff >= 0 ? '+' : ''}${solTokenDiff.toFixed(2)}`);
            console.log(`   Base Tokens: ${baseTokenDiff >= 0 ? '+' : ''}${baseTokenDiff.toFixed(2)}`);
        }

        // Simulation Details
        if (this.verbose) {
            console.log('\n🧪 SIMULATION DETAILS:');
            console.log(`   Buy: ${simulation.buySimulation.chain} (${simulation.buySimulation.type})`);
            console.log(`   Sell: ${simulation.sellSimulation.chain} (${simulation.sellSimulation.type})`);
            console.log(`   Total Cost: $${simulation.totalCostUsd.toFixed(4)}`);
            console.log(`   Total Revenue: $${simulation.totalRevenueUsd.toFixed(2)}`);
            console.log(`   Net Profit: $${simulation.netProfitUsd.toFixed(4)} (${simulation.netProfitPercent.toFixed(2)}%)`);
        }

        console.log('\n' + '='.repeat(100) + '\n');
    }

    /**
     * Send notification about failed trade
     */
    async notifyTradeFailed(
        opportunity: Opportunity,
        reason: string,
        error?: Error
    ): Promise<void> {
        console.log('\n' + '='.repeat(100));
        console.log('❌ TRADE EXECUTION FAILED');
        console.log('='.repeat(100));
        console.log(`   Reason: ${reason}`);
        if (error) {
            console.log(`   Error: ${error.message}`);
            if (this.verbose && error.stack) {
                console.log(`   Stack: ${error.stack}`);
            }
        }
        console.log(`   Trade Size: ${Number(opportunity.optimalTradeSize.solana.tokenAmount) / 1e6} tokens`);
        console.log(`   Direction: ${opportunity.direction}`);
        console.log(`   Timestamp: ${new Date().toISOString()}`);
        console.log('='.repeat(100) + '\n');
    }

    /**
     * Send system notification (errors, warnings, etc.)
     */
    async notifySystem(
        level: 'info' | 'warning' | 'error',
        message: string,
        details?: any
    ): Promise<void> {
        const emoji = level === 'error' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
        const levelStr = level.toUpperCase();

        console.log(`\n${emoji} [${levelStr}] ${message}`);
        if (details && this.verbose) {
            console.log('   Details:', details);
        }
        console.log('');
    }

    /**
     * Print wallet balances in a formatted manner
     */
    private printWalletBalances(balances: {
        solana: { sol: number; token: number };
        base: { eth: number; usdc: number; token: number };
    }): void {
        console.log('   Solana:');
        console.log(`      SOL: ${balances.solana.sol.toFixed(4)}`);
        console.log(`      Tokens: ${balances.solana.token.toFixed(2)}`);
        console.log('   Base:');
        console.log(`      ETH: ${balances.base.eth.toFixed(6)}`);
        console.log(`      USDC: ${balances.base.usdc.toFixed(2)}`);
        console.log(`      Tokens: ${balances.base.token.toFixed(2)}`);
    }
}

// Singleton instance
let notificationService: NotificationService | null = null;

export function getNotificationService(verbose: boolean = true): NotificationService {
    if (!notificationService) {
        notificationService = new NotificationService(verbose);
    }
    return notificationService;
}
