/**
 * Type definitions and constants for Base Volume Bot
 */

export interface VolumeConfig {
    rpcUrl: string;
    privateKey: string;
    tokenAddress: string;
    usdcAddress: string;
    routerAddress: string;
    minTradeAmountUsdc: number;
    maxTradeAmountUsdc: number;
    tradingIntervalMs: number;
    slippageBps: number;
    // Hardcoded parameters
    summaryIntervalMs: number;
    deadlineSeconds: number;
    buyProbability: number;
    randomizeTradeSize: boolean;
    maxTotalVolumeUsd: number;
    runDurationMinutes: number;
}

export interface TradeRecord {
    timestamp: Date;
    direction: 'BUY' | 'SELL';
    tokenAmount: number;
    usdcAmount: number;
    usdValue: number;
    gasUsedEth: number;
    transactionHash: string;
    success: boolean;
    error?: string;
}

export interface PnLSummary {
    totalBuys: number;
    totalSells: number;
    totalBuyVolumeUsdc: number;
    totalSellVolumeUsdc: number;
    totalBuyVolumeUsd: number;
    totalSellVolumeUsd: number;
    totalGasUsedEth: number;
    totalGasUsedUsd: number;
    netUsdcChange: number;
    currentEthBalance: number;
    currentUsdcBalance: number;
    currentTokenBalance: number;
    estimatedPnlUsd: number;
}

/**
 * Hardcoded default values for non-essential parameters
 */
export const HARDCODED_DEFAULTS = {
    SUMMARY_INTERVAL_SECONDS: 300, // 5 minutes
    DEADLINE_SECONDS: 30,
    BUY_PROBABILITY: 50, // 50% chance of buy vs sell
    RANDOMIZE_TRADE_SIZE: true,
    MAX_TOTAL_VOLUME_USD: 0, // Unlimited
    RUN_DURATION_MINUTES: 0, // Infinite
} as const;
