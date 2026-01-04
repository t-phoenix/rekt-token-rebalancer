/**
 * Type definitions for the arbitrage bot
 */

export interface PriceData {
  price: number; // Price in USD
  timestamp: number; // Unix timestamp in ms
  source: 'event' | 'api' | 'simulation';
  chain: 'solana' | 'base';
}

export interface VolumeData {
  volume24h: number;
  volume1h: number;
  lastTradeSize: number;
  lastTradeTime: number;
}

export interface LiquidityData {
  solana: {
    solReserves: bigint;
    tokenReserves: bigint;
    virtualSolReserves: bigint;
    virtualTokenReserves: bigint;
  };
  base: {
    usdcReserves: bigint;
    tokenReserves: bigint;
  };
}

export interface Balances {
  solana: {
    sol: number;
    token: number;
  };
  base: {
    eth: number;
    usdc: number;
    token: number;
  };
}

export interface TradeSize {
  solana: {
    tokenAmount: bigint;
    solAmount: number;
  };
  base: {
    tokenAmount: bigint;
    usdcAmount: number;
  };
}

export interface SimulationResult {
  chain: 'solana' | 'base';
  type: 'buy' | 'sell';
  inputAmount: bigint;
  outputAmount: bigint;
  inputAmountFormatted: number;
  outputAmountFormatted: number;
  priceImpact: number; // Percentage
  gasEstimate: bigint;
  gasCostUsd: number;
  slippage: number; // Actual slippage
  success: boolean;
  error?: string;
}

export interface ArbitrageSimulation {
  opportunity: Opportunity;
  buySimulation: SimulationResult;
  sellSimulation: SimulationResult;
  netProfitUsd: number;
  netProfitPercent: number;
  totalCostUsd: number;
  totalRevenueUsd: number;
  executionTimeEstimate: number; // ms
  riskScore: number; // 0-100, lower is riskier
  success: boolean;
  warnings: string[];
  failureReason?: string;
}

export interface Opportunity {
  id: string;
  detectedAt: number;
  solanaPrice: PriceData;
  basePrice: PriceData;
  priceDifferencePercent: number;
  direction: 'SOLANA_TO_BASE' | 'BASE_TO_SOLANA';
  optimalTradeSize: TradeSize;
  estimatedProfitUsd: number;
  estimatedProfitPercent: number;
  liquidity: LiquidityData;
  balances: Balances;
  stale: boolean;
}

export interface TradePlan {
  opportunity: Opportunity;
  simulation: ArbitrageSimulation;
  buyChain: 'solana' | 'base';
  sellChain: 'solana' | 'base';
  buyTransaction: TransactionPlan;
  sellTransaction: TransactionPlan;
  estimatedExecutionTime: number;
}

export interface TransactionPlan {
  chain: 'solana' | 'base';
  type: 'buy' | 'sell';
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin?: bigint; // For sell transactions
  amountInMax?: bigint; // For buy transactions
  slippageBps: number;
  deadline: bigint;
  gasEstimate: bigint;
  priorityFee?: number; // For Solana
}

export interface ExecutionProgress {
  stage: 'validating' | 'buying' | 'buy_pending' | 'selling' | 'sell_pending' | 'completed' | 'failed';
  buyTxHash?: string;
  sellTxHash?: string;
  buyConfirmed?: boolean;
  sellConfirmed?: boolean;
  progress: number; // 0-100
  message: string;
}

export interface ExecutionResult {
  plan: TradePlan;
  buyTxHash?: string;
  sellTxHash?: string;
  buyBlockNumber?: number;
  sellBlockNumber?: number;
  actualBuyAmount: bigint;
  actualSellAmount: bigint;
  actualBuyCostUsd: number;
  actualSellRevenueUsd: number;
  actualGasCostUsd: number;
  actualProfitUsd: number;
  actualProfitPercent: number;
  executionTime: number; // ms
  success: boolean;
  error?: string;
  warnings: string[];
}

export interface MarketEvent {
  chain: 'solana' | 'base';
  type: 'buy' | 'sell';
  timestamp: number;
  txHash: string;
  amount: bigint;
  price: number;
  volume: number;
}

export interface ArbitrageConfig {
  // Profit thresholds
  minProfitPercent: number;
  minProfitUsd: number;

  // Risk management
  maxTradeSizeUsd: number;
  maxPriceImpact: number; // Percentage
  slippageTolerance: number; // Percentage (as decimal, e.g., 0.005 for 0.5%)

  // Execution
  revalidateBeforeExecute: boolean;
  staleOpportunityTimeout: number; // ms
  executionTimeout: number; // ms
  priceStalenessThreshold: number; // ms

  // Gas/Fees
  gasMultiplier: number; // Safety multiplier for gas estimates
  priorityFeeMultiplier: number; // For Solana priority fees

  // Event handling
  eventDebounceMs: number;
  maxConcurrentTrades: number;

  // Trade size optimization
  minLiquidityUsd: number; // Minimum liquidity required
  maxPriceImpactForTrade: number; // Max price impact to consider trade
}

