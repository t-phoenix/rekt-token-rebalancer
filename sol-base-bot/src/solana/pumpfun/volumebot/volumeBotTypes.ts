/**
 * Type definitions and constants for Solana Volume Bot
 */

export interface VolumeConfig {
    rpcUrl: string;
    privateKey: string;
    tokenMint: string;
    minTradeAmountSol: number;
    maxTradeAmountSol: number;
    tradingIntervalMs: number;
    slippagePercent: number;
    // Hardcoded parameters
    summaryIntervalMs: number;
    priorityFeeSol: number;
    buyProbability: number;
    randomizeTradeSize: boolean;
    maxTotalVolumeUsd: number;
    runDurationMinutes: number;
}

export interface TradeRecord {
    timestamp: Date;
    direction: 'BUY' | 'SELL';
    tokenAmount: number;
    solAmount: number;
    usdValue: number;
    gasUsedSol: number;
    signature: string;
    success: boolean;
    error?: string;
}

export interface PnLSummary {
    totalBuys: number;
    totalSells: number;
    totalBuyVolumeSol: number;
    totalSellVolumeSol: number;
    totalBuyVolumeUsd: number;
    totalSellVolumeUsd: number;
    totalGasUsedSol: number;
    totalGasUsedUsd: number;
    netSolChange: number;
    currentSolBalance: number;
    currentTokenBalance: number;
    estimatedPnlUsd: number;
}

/**
 * Hardcoded default values for non-essential parameters
 */
export const HARDCODED_DEFAULTS = {
    SUMMARY_INTERVAL_SECONDS: 300, // 5 minutes
    PRIORITY_FEE_SOL: 0.0001,
    BUY_PROBABILITY: 50, // 50% chance of buy vs sell
    RANDOMIZE_TRADE_SIZE: true,
    MAX_TOTAL_VOLUME_USD: 0, // Unlimited
    RUN_DURATION_MINUTES: 0, // Infinite
} as const;
