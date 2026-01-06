/**
 * Event Coordinator
 * 
 * Coordinates event monitoring across both Solana and Base chains.
 * Subscribes to trade/swap events and triggers arbitrage analysis when price thresholds are met.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider } from 'ethers';
import { subscribeToTradeEvents, type TradeEvent } from '../solana/pumpfun/events.js';
import { subscribeToSwapEvents, getPairAddress, type SwapEvent } from '../base/uniswap/events.js';
import { PriceTracker, type PriceChangeEvent } from './priceTracker.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export interface EventCoordinatorConfig {
    // Required addresses
    solanaMint: PublicKey;
    baseTokenAddress: string;
    baseUsdcAddress: string;
    baseRouterAddress: string;

    // Price tracking
    priceMovementThreshold: number;  // Percentage (e.g., 2.0 for 2%)

    // Event polling
    solanaEventPollInterval: number;  // ms
    baseEventPollInterval: number;    // ms

    // Cooldown settings
    analysisCooldownMs: number;       // Minimum time between analyses

    // Logging
    logAllEvents: boolean;
}

export type ArbitrageTriggerCallback = (event: PriceChangeEvent) => Promise<void>;

export class EventCoordinator {
    private readonly config: EventCoordinatorConfig;
    private readonly priceTracker: PriceTracker;
    private readonly solanaConnection: Connection;
    private readonly baseProvider: JsonRpcProvider;

    private solanaSubscription: any = null;
    private baseSubscription: any = null;

    private isAnalysisRunning: boolean = false;
    private lastAnalysisTime: number = 0;

    private triggerCallback: ArbitrageTriggerCallback | null = null;

    private eventCounts = {
        solana: 0,
        base: 0
    };

    constructor(
        config: EventCoordinatorConfig,
        solanaConnection: Connection,
        baseProvider: JsonRpcProvider
    ) {
        this.config = config;
        this.solanaConnection = solanaConnection;
        this.baseProvider = baseProvider;

        this.priceTracker = new PriceTracker(
            config.priceMovementThreshold,
            100  // Keep last 100 price snapshots
        );
    }

    /**
     * Register callback for when arbitrage analysis should be triggered
     */
    onArbitrageTrigger(callback: ArbitrageTriggerCallback): void {
        this.triggerCallback = callback;
    }

    /**
     * Start monitoring events on both chains
     */
    async start(): Promise<void> {
        console.log('🎯 Starting event monitoring...');
        console.log(`   Triggering analysis on: EVERY EVENT`);
        console.log(`   Analysis cooldown: ${this.config.analysisCooldownMs / 1000}s`);
        console.log('');

        // Subscribe to Solana Pump.fun events
        this.subscribeToSolanaEvents();

        // Subscribe to Base Uniswap events
        await this.subscribeToBaseEvents();

        console.log('✅ Event monitoring active\n');
    }

    /**
     * Stop monitoring events
     */
    stop(): void {
        console.log('🛑 Stopping event monitoring...');

        if (this.solanaSubscription) {
            this.solanaSubscription.unsubscribe();
            this.solanaSubscription = null;
        }

        if (this.baseSubscription) {
            this.baseSubscription.unsubscribe();
            this.baseSubscription = null;
        }

        console.log('✅ Event monitoring stopped\n');
    }

    /**
     * Subscribe to Solana Pump.fun trade events
     */
    private subscribeToSolanaEvents(): void {
        console.log(`📡 Subscribing to Pump.fun events for ${this.config.solanaMint.toBase58()}`);

        this.solanaSubscription = subscribeToTradeEvents(
            this.solanaConnection,
            (event: TradeEvent) => this.handleSolanaTradeEvent(event),
            this.config.solanaMint,
            this.config.solanaEventPollInterval,
            true  // Use polling mode
        );
    }

    /**
     * Subscribe to Base Uniswap swap events
     */
    private async subscribeToBaseEvents(): Promise<void> {
        console.log(`📡 Subscribing to Uniswap events...`);

        // Get the pair address
        const pairAddress = await getPairAddress(
            this.baseProvider,
            this.config.baseRouterAddress,
            this.config.baseTokenAddress,
            this.config.baseUsdcAddress
        );

        console.log(`   Pair: ${pairAddress}`);

        this.baseSubscription = subscribeToSwapEvents(
            this.baseProvider,
            pairAddress,
            this.config.baseTokenAddress,
            this.config.baseUsdcAddress,
            (event: SwapEvent) => this.handleBaseSwapEvent(event),
            this.config.baseEventPollInterval,
            true  // Use polling mode
        );
    }

    /**
     * Handle Solana trade event
     */
    private async handleSolanaTradeEvent(event: TradeEvent): Promise<void> {
        this.eventCounts.solana++;

        if (this.config.logAllEvents) {
            console.log(`[Solana Event #${this.eventCounts.solana}] ${event.isBuy ? 'BUY' : 'SELL'}`);
            console.log(`   Tokens: ${Number(event.tokenAmount) / 1e6}`);
            console.log(`   SOL: ${Number(event.solAmount) / LAMPORTS_PER_SOL}`);
        }

        // Calculate price (SOL per token)
        const solPerToken = Number(event.solAmount) / Number(event.tokenAmount);

        // Update price tracker for monitoring
        this.priceTracker.updatePrice('solana', solPerToken, 'event');

        // Trigger analysis on every event (respecting cooldown)
        await this.triggerAnalysisIfReady('solana');
    }

    /**
     * Handle Base swap event
     */
    private async handleBaseSwapEvent(event: SwapEvent): Promise<void> {
        this.eventCounts.base++;

        if (this.config.logAllEvents) {
            console.log(`[Base Event #${this.eventCounts.base}] SWAP`);
            console.log(`   Amount0In: ${event.amount0In}`);
            console.log(`   Amount1In: ${event.amount1In}`);
            console.log(`   Amount0Out: ${event.amount0Out}`);
            console.log(`   Amount1Out: ${event.amount1Out}`);
        }

        // Calculate USDC per token from the swap
        let usdcPerToken = 0;

        if (event.amount0In > 0n && event.amount1Out > 0n) {
            // Buying tokens (USDC in, tokens out)
            usdcPerToken = Number(event.amount0In) / Number(event.amount1Out);
        } else if (event.amount1In > 0n && event.amount0Out > 0n) {
            // Selling tokens (tokens in, USDC out)
            usdcPerToken = Number(event.amount0Out) / Number(event.amount1In);
        }

        if (usdcPerToken > 0) {
            // Update price tracker for monitoring
            this.priceTracker.updatePrice('base', usdcPerToken, 'event');
        }

        // Trigger analysis on every event (respecting cooldown)
        await this.triggerAnalysisIfReady('base');
    }

    /**
     * Trigger analysis if cooldown period has passed
     */
    private async triggerAnalysisIfReady(chain: 'solana' | 'base'): Promise<void> {
        // Check if in cooldown period
        const timeSinceLastAnalysis = Date.now() - this.lastAnalysisTime;
        if (timeSinceLastAnalysis < this.config.analysisCooldownMs) {
            return; // Skip silently during cooldown
        }

        // Check if analysis is already running
        if (this.isAnalysisRunning) {
            return; // Skip silently if already running
        }

        console.log('\n' + '='.repeat(80));
        console.log(`🚨 EVENT DETECTED - TRIGGERING ARBITRAGE ANALYSIS`);
        console.log('='.repeat(80));
        console.log(`   Chain: ${chain.toUpperCase()}`);
        console.log(`   Event Count - Solana: ${this.eventCounts.solana}, Base: ${this.eventCounts.base}`);
        console.log('='.repeat(80) + '\n');

        // Mark analysis as running
        this.isAnalysisRunning = true;
        this.lastAnalysisTime = Date.now();

        try {
            // Call the registered callback
            if (this.triggerCallback) {
                await this.triggerCallback({
                    chain,
                    percentChange: 0, // Not using price threshold anymore
                    currentSnapshot: this.priceTracker.getCurrentSnapshot() || {
                        solanaPrice: 0,
                        basePrice: 0,
                        timestamp: Date.now(),
                        source: 'event'
                    },
                    baselineSnapshot: this.priceTracker.getBaselineSnapshot() || {
                        solanaPrice: 0,
                        basePrice: 0,
                        timestamp: Date.now(),
                        source: 'event'
                    }
                });
            }

            // Reset baseline after successful analysis
            this.priceTracker.resetBaseline();

        } catch (error) {
            console.error('❌ Error during arbitrage analysis:', error);
        } finally {
            this.isAnalysisRunning = false;
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            eventCounts: { ...this.eventCounts },
            currentPrices: this.priceTracker.getCurrentSnapshot(),
            baselinePrices: this.priceTracker.getBaselineSnapshot(),
            currentChanges: this.priceTracker.getCurrentChanges(),
            isAnalysisRunning: this.isAnalysisRunning,
            lastAnalysisTime: this.lastAnalysisTime
        };
    }

    /**
     * Force reset price baseline (useful after manual intervention)
     */
    resetPriceBaseline(): void {
        this.priceTracker.resetBaseline();
    }
}
