/**
 * Price Tracker
 * 
 * Monitors price movements across chains and determines when to trigger arbitrage analysis.
 * Maintains baseline prices and calculates percentage changes to detect significant movements.
 */

export interface PriceSnapshot {
    solanaPrice: number;  // SOL per token
    basePrice: number;    // USDC per token
    timestamp: number;
    source: 'event' | 'poll';
}

export interface PriceChangeEvent {
    chain: 'solana' | 'base' | 'both';
    percentChange: number;
    currentSnapshot: PriceSnapshot;
    baselineSnapshot: PriceSnapshot;
}

export type PriceChangeCallback = (event: PriceChangeEvent) => void;

export class PriceTracker {
    private baselineSnapshot: PriceSnapshot | null = null;
    private currentSnapshot: PriceSnapshot | null = null;
    private priceHistory: PriceSnapshot[] = [];

    private readonly threshold: number;
    private readonly maxHistorySize: number;
    private callbacks: PriceChangeCallback[] = [];

    constructor(
        threshold: number = 2.0,  // 2% default
        maxHistorySize: number = 100
    ) {
        this.threshold = threshold;
        this.maxHistorySize = maxHistorySize;
    }

    /**
     * Register a callback to be called when price threshold is exceeded
     */
    onThresholdExceeded(callback: PriceChangeCallback): void {
        this.callbacks.push(callback);
    }

    /**
     * Update price for a specific chain
     * Returns true if threshold was exceeded
     */
    updatePrice(
        chain: 'solana' | 'base',
        newPrice: number,
        source: 'event' | 'poll' = 'event'
    ): boolean {
        const now = Date.now();

        // Initialize or update current snapshot
        if (!this.currentSnapshot) {
            this.currentSnapshot = {
                solanaPrice: chain === 'solana' ? newPrice : 0,
                basePrice: chain === 'base' ? newPrice : 0,
                timestamp: now,
                source
            };

            // Set as baseline if this is the first price
            if (!this.baselineSnapshot) {
                this.baselineSnapshot = { ...this.currentSnapshot };
            }

            return false;
        }

        // Update the appropriate price
        const updatedSnapshot: PriceSnapshot = {
            solanaPrice: chain === 'solana' ? newPrice : this.currentSnapshot.solanaPrice,
            basePrice: chain === 'base' ? newPrice : this.currentSnapshot.basePrice,
            timestamp: now,
            source
        };

        this.currentSnapshot = updatedSnapshot;
        this.addToHistory(updatedSnapshot);

        // Check if threshold exceeded
        if (this.baselineSnapshot && this.hasExceededThreshold()) {
            const percentChange = this.calculateMaxChange();
            const affectedChain = this.getAffectedChain();

            const event: PriceChangeEvent = {
                chain: affectedChain,
                percentChange,
                currentSnapshot: { ...this.currentSnapshot },
                baselineSnapshot: { ...this.baselineSnapshot }
            };

            // Notify all callbacks
            this.callbacks.forEach(cb => cb(event));

            return true;
        }

        return false;
    }

    /**
     * Check if price movement exceeds threshold
     */
    private hasExceededThreshold(): boolean {
        if (!this.baselineSnapshot || !this.currentSnapshot) {
            return false;
        }

        const solanaChange = this.calculatePercentChange(
            this.baselineSnapshot.solanaPrice,
            this.currentSnapshot.solanaPrice
        );

        const baseChange = this.calculatePercentChange(
            this.baselineSnapshot.basePrice,
            this.currentSnapshot.basePrice
        );

        return Math.abs(solanaChange) >= this.threshold ||
            Math.abs(baseChange) >= this.threshold;
    }

    /**
     * Calculate maximum price change across both chains
     */
    private calculateMaxChange(): number {
        if (!this.baselineSnapshot || !this.currentSnapshot) {
            return 0;
        }

        const solanaChange = this.calculatePercentChange(
            this.baselineSnapshot.solanaPrice,
            this.currentSnapshot.solanaPrice
        );

        const baseChange = this.calculatePercentChange(
            this.baselineSnapshot.basePrice,
            this.currentSnapshot.basePrice
        );

        return Math.max(Math.abs(solanaChange), Math.abs(baseChange));
    }

    /**
     * Determine which chain(s) triggered the threshold
     */
    private getAffectedChain(): 'solana' | 'base' | 'both' {
        if (!this.baselineSnapshot || !this.currentSnapshot) {
            return 'both';
        }

        const solanaChange = Math.abs(this.calculatePercentChange(
            this.baselineSnapshot.solanaPrice,
            this.currentSnapshot.solanaPrice
        ));

        const baseChange = Math.abs(this.calculatePercentChange(
            this.baselineSnapshot.basePrice,
            this.currentSnapshot.basePrice
        ));

        const solanaExceeded = solanaChange >= this.threshold;
        const baseExceeded = baseChange >= this.threshold;

        if (solanaExceeded && baseExceeded) return 'both';
        if (solanaExceeded) return 'solana';
        if (baseExceeded) return 'base';
        return 'both';
    }

    /**
     * Calculate percentage change between two prices
     */
    private calculatePercentChange(oldPrice: number, newPrice: number): number {
        if (oldPrice === 0) return 0;
        return ((newPrice - oldPrice) / oldPrice) * 100;
    }

    /**
     * Add snapshot to history
     */
    private addToHistory(snapshot: PriceSnapshot): void {
        this.priceHistory.push(snapshot);

        // Trim history if it exceeds max size
        if (this.priceHistory.length > this.maxHistorySize) {
            this.priceHistory.shift();
        }
    }

    /**
     * Reset baseline to current prices (called after analysis)
     */
    resetBaseline(): void {
        if (this.currentSnapshot) {
            this.baselineSnapshot = { ...this.currentSnapshot };
            console.log(`📊 Price baseline reset:`);
            console.log(`   Solana: ${this.baselineSnapshot.solanaPrice.toFixed(8)} SOL/token`);
            console.log(`   Base: ${this.baselineSnapshot.basePrice.toFixed(6)} USDC/token`);
        }
    }

    /**
     * Get current price snapshot
     */
    getCurrentSnapshot(): PriceSnapshot | null {
        return this.currentSnapshot ? { ...this.currentSnapshot } : null;
    }

    /**
     * Get baseline snapshot
     */
    getBaselineSnapshot(): PriceSnapshot | null {
        return this.baselineSnapshot ? { ...this.baselineSnapshot } : null;
    }

    /**
     * Get price history
     */
    getHistory(): PriceSnapshot[] {
        return [...this.priceHistory];
    }

    /**
     * Get current percentage changes
     */
    getCurrentChanges(): { solana: number; base: number } | null {
        if (!this.baselineSnapshot || !this.currentSnapshot) {
            return null;
        }

        return {
            solana: this.calculatePercentChange(
                this.baselineSnapshot.solanaPrice,
                this.currentSnapshot.solanaPrice
            ),
            base: this.calculatePercentChange(
                this.baselineSnapshot.basePrice,
                this.currentSnapshot.basePrice
            )
        };
    }

    /**
     * Clear all data (useful for testing)
     */
    reset(): void {
        this.baselineSnapshot = null;
        this.currentSnapshot = null;
        this.priceHistory = [];
    }
}
