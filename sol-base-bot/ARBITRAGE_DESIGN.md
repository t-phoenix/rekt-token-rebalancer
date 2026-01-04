# Arbitrage Bot - Design Document

## Overview

This document outlines the design for a cross-chain arbitrage bot that monitors price differences between Pump Fun (Solana) and Uniswap V2 (Base) for the same token, simulates trades, and executes profitable opportunities.

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Arbitrage Orchestrator                    │
│  - Market Data Aggregator                                    │
│  - Opportunity Analyzer                                      │
│  - Trade Simulator                                           │
│  - Execution Manager                                         │
│  - Event Coordinator                                         │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Solana Chain │    │  Base Chain  │    │   CLI/UI     │
│  - Events    │    │  - Events    │    │  - Display   │
│  - Pricing   │    │  - Pricing   │    │  - Confirm   │
│  - Trading   │    │  - Trading   │    │  - Monitor   │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Design Principles

### 1. **Event-Driven Architecture**
- Real-time event listeners on both chains
- Event-driven recalculation (not polling-based)
- Debouncing to avoid excessive calculations

### 2. **Simulation-First Approach**
- Always simulate before execution
- Compare simulation results with actual execution
- Track simulation accuracy over time

### 3. **State Management**
- Maintain current market state (prices, volumes, balances)
- Track pending transactions
- Handle transaction failures gracefully

### 4. **Risk Management**
- Minimum profit thresholds
- Maximum position sizes
- Slippage protection
- Gas cost considerations

## Data Flow

### 1. Initialization Phase

```
Start Bot
  ├─> Load Configuration
  ├─> Initialize Connections (Solana, Base)
  ├─> Check Wallet Balances
  ├─> Fetch Initial Prices
  ├─> Start Event Listeners
  └─> Begin Monitoring Loop
```

### 2. Event-Driven Price Update

```
Market Event (Buy/Sell on either chain)
  ├─> Parse Event Data
  ├─> Update Market State
  │   ├─> Update Price
  │   ├─> Update Volume
  │   └─> Update Liquidity
  ├─> Trigger Opportunity Analysis
  └─> If Opportunity Found → Simulate Trades
```

### 3. Opportunity Analysis Flow

```
Price Update Detected
  ├─> Calculate Price Difference
  ├─> Check Minimum Profit Threshold
  ├─> Check Available Liquidity
  ├─> Check Wallet Balances
  ├─> Calculate Optimal Trade Size
  └─> If Profitable → Generate Trade Plan
```

### 4. Trade Simulation Flow

```
Trade Plan Generated
  ├─> Simulate Buy on Cheaper Chain
  │   ├─> Calculate exact amounts
  │   ├─> Estimate gas/fees
  │   ├─> Calculate price impact
  │   └─> Check slippage
  ├─> Simulate Sell on Expensive Chain
  │   ├─> Calculate exact amounts
  │   ├─> Estimate gas/fees
  │   ├─> Calculate price impact
  │   └─> Check slippage
  ├─> Calculate Net Profit
  │   ├─> Revenue (sell amount)
  │   ├─> Cost (buy amount + fees)
  │   └─> Net = Revenue - Cost
  └─> If Net Profit > Threshold → Show to User
```

### 5. Execution Flow

```
User Confirms Trade
  ├─> Re-validate Opportunity (prices may have changed)
  ├─> Check Balances Again
  ├─> Execute Buy Transaction (cheaper chain)
  │   ├─> Build Transaction
  │   ├─> Simulate (final check)
  │   ├─> Send Transaction
  │   └─> Wait for Confirmation
  ├─> Wait for Bridge/Transfer (if needed)
  ├─> Execute Sell Transaction (expensive chain)
  │   ├─> Build Transaction
  │   ├─> Simulate (final check)
  │   ├─> Send Transaction
  │   └─> Wait for Confirmation
  ├─> Calculate Actual Profit
  └─> Log Results
```

## Common Pitfalls & Solutions

### 1. **Race Conditions**

**Problem**: Prices change between simulation and execution, leading to unprofitable trades.

**Solution**:
- Re-simulate immediately before execution
- Use transaction deadlines/slippage protection
- Implement "stale opportunity" detection (if price changed >X%, cancel)
- Use atomic transactions where possible

**Implementation**:
```typescript
// Before execution, re-check prices
const currentPrices = await fetchCurrentPrices();
if (Math.abs(currentPrices.solana - opportunity.solanaPrice) > 0.05) {
  console.log('⚠️  Price changed significantly, cancelling trade');
  return;
}
```

### 2. **Slippage & Price Impact**

**Problem**: Large trades move the market, reducing profitability.

**Solution**:
- Calculate price impact before trading
- Use optimal trade size (not maximum)
- Split large trades into smaller chunks
- Set conservative slippage tolerances

**Implementation**:
```typescript
// Calculate optimal trade size based on liquidity
const optimalSize = calculateOptimalTradeSize(
  priceDifference,
  liquidity,
  maxPriceImpact: 0.01 // 1% max impact
);
```

### 3. **Gas/Fee Estimation Errors**

**Problem**: Underestimating gas costs can turn profitable trades into losses.

**Solution**:
- Use conservative gas estimates (multiply by 1.5x)
- Monitor actual gas costs vs estimates
- Include priority fees in calculations
- Account for approval transactions

**Implementation**:
```typescript
const estimatedGas = await estimateGas(transaction);
const gasCost = estimatedGas * gasPrice * 1.5; // 50% buffer
```

### 4. **Event Listener Reliability**

**Problem**: Missing events or processing duplicates.

**Solution**:
- Use transaction hash deduplication
- Implement event replay mechanism
- Fallback to polling if WebSocket fails
- Track processed events in memory/DB

**Implementation**:
```typescript
const processedEvents = new Set<string>();

eventListener.on('swap', (event) => {
  if (processedEvents.has(event.txHash)) {
    return; // Skip duplicate
  }
  processedEvents.add(event.txHash);
  // Process event...
});
```

### 5. **Balance Management**

**Problem**: Insufficient balances for execution, especially after partial fills.

**Solution**:
- Check balances before each trade
- Reserve minimum balance for gas
- Track pending transactions
- Implement balance refresh after each trade

**Implementation**:
```typescript
async function checkBalancesBeforeTrade(required: TradeRequirements) {
  const balances = await fetchBalances();
  
  if (balances.solana.sol < required.solana.sol + GAS_RESERVE) {
    throw new Error('Insufficient SOL balance');
  }
  
  if (balances.base.usdc < required.base.usdc + GAS_RESERVE) {
    throw new Error('Insufficient USDC balance');
  }
}
```

### 6. **Concurrent Trade Execution**

**Problem**: Multiple opportunities detected simultaneously, causing conflicts.

**Solution**:
- Implement trade queue/lock
- Process one opportunity at a time
- Cancel stale opportunities
- Use state machine for trade lifecycle

**Implementation**:
```typescript
class TradeManager {
  private isExecuting = false;
  private tradeQueue: TradeOpportunity[] = [];
  
  async executeTrade(opportunity: TradeOpportunity) {
    if (this.isExecuting) {
      this.tradeQueue.push(opportunity);
      return;
    }
    
    this.isExecuting = true;
    try {
      await this.execute(opportunity);
    } finally {
      this.isExecuting = false;
      this.processQueue();
    }
  }
}
```

### 7. **Network Congestion**

**Problem**: Transactions stuck or delayed, causing opportunity to expire.

**Solution**:
- Use priority fees (Solana) and higher gas prices (Base)
- Set appropriate transaction deadlines
- Monitor transaction status
- Implement timeout and retry logic

**Implementation**:
```typescript
// Solana: Use priority fees
const priorityFee = calculatePriorityFee(opportunity.profit);
transaction.add(ComputeBudgetProgram.setComputeUnitPrice(priorityFee));

// Base: Use higher gas price
const gasPrice = await provider.getFeeData();
const tx = await contract.function({
  gasPrice: gasPrice.gasPrice * 1.2, // 20% premium
});
```

### 8. **Price Oracle Accuracy**

**Problem**: Using stale or inaccurate price data.

**Solution**:
- Fetch prices from multiple sources
- Use on-chain data (events) as primary source
- Implement price staleness checks
- Cache prices with TTL

**Implementation**:
```typescript
interface PriceData {
  price: number;
  timestamp: number;
  source: 'event' | 'api' | 'simulation';
}

function isPriceStale(price: PriceData, maxAge: number = 5000): boolean {
  return Date.now() - price.timestamp > maxAge;
}
```

## Implementation Structure

### Core Modules

#### 1. `ArbitrageOrchestrator`
Main coordinator that manages the entire arbitrage flow.

```typescript
class ArbitrageOrchestrator {
  private marketData: MarketDataManager;
  private opportunityAnalyzer: OpportunityAnalyzer;
  private tradeSimulator: TradeSimulator;
  private executionManager: ExecutionManager;
  private eventCoordinator: EventCoordinator;
  
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async onMarketEvent(event: MarketEvent): Promise<void>;
}
```

#### 2. `MarketDataManager`
Manages current market state (prices, volumes, liquidity).

```typescript
class MarketDataManager {
  private solanaPrice: PriceData;
  private basePrice: PriceData;
  private solanaVolume: VolumeData;
  private baseVolume: VolumeData;
  
  updatePrice(chain: 'solana' | 'base', price: PriceData): void;
  getPrice(chain: 'solana' | 'base'): PriceData;
  getPriceDifference(): number;
}
```

#### 3. `OpportunityAnalyzer`
Analyzes market data to find profitable opportunities.

```typescript
class OpportunityAnalyzer {
  analyze(
    solanaPrice: PriceData,
    basePrice: PriceData,
    balances: Balances
  ): Opportunity | null;
  
  calculateOptimalTradeSize(
    priceDiff: number,
    liquidity: LiquidityData
  ): TradeSize;
}
```

#### 4. `TradeSimulator`
Simulates trades on both chains to estimate profitability.

```typescript
class TradeSimulator {
  async simulateBuy(
    chain: 'solana' | 'base',
    amount: bigint
  ): Promise<SimulationResult>;
  
  async simulateSell(
    chain: 'solana' | 'base',
    amount: bigint
  ): Promise<SimulationResult>;
  
  async simulateArbitrage(
    opportunity: Opportunity
  ): Promise<ArbitrageSimulation>;
}
```

#### 5. `ExecutionManager`
Handles trade execution with safety checks.

```typescript
class ExecutionManager {
  private tradeLock: boolean = false;
  
  async executeTrade(
    plan: TradePlan,
    confirmation: boolean
  ): Promise<ExecutionResult>;
  
  private async executeBuy(chain: 'solana' | 'base'): Promise<string>;
  private async executeSell(chain: 'solana' | 'base'): Promise<string>;
  private async waitForConfirmation(txHash: string): Promise<void>;
}
```

#### 6. `EventCoordinator`
Coordinates event listeners from both chains.

```typescript
class EventCoordinator {
  private solanaSubscription: Subscription;
  private baseSubscription: Subscription;
  
  start(): void;
  stop(): void;
  onSolanaEvent(event: TradeEvent): void;
  onBaseEvent(event: SwapEvent): void;
}
```

## CLI Integration

### Interactive Mode

```typescript
interface CLIDisplay {
  showOpportunity(opportunity: Opportunity): void;
  showSimulation(simulation: ArbitrageSimulation): void;
  promptConfirmation(): Promise<boolean>;
  showExecutionProgress(progress: ExecutionProgress): void;
  showResults(results: ExecutionResult): void;
}
```

### Display Format

```
╔══════════════════════════════════════════════════════════╗
║          ARBITRAGE OPPORTUNITY DETECTED                  ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  Price Difference: 2.5%                                  ║
║  Solana Price: $0.00012345                              ║
║  Base Price:    $0.00012650                              ║
║                                                          ║
║  ┌────────────────────────────────────────────────┐     ║
║  │ BUY on Solana                                  │     ║
║  │   Amount: 1,000,000 tokens                    │     ║
║  │   Cost: 0.123 SOL ($24.60)                    │     ║
║  │   Gas: 0.001 SOL ($0.20)                       │     ║
║  │   Price Impact: 0.5%                           │     ║
║  └────────────────────────────────────────────────┘     ║
║                                                          ║
║  ┌────────────────────────────────────────────────┐     ║
║  │ SELL on Base                                    │     ║
║  │   Amount: 1,000,000 tokens                    │     ║
║  │   Revenue: 126.50 USDC                         │     ║
║  │   Gas: 0.0001 ETH ($0.30)                      │     ║
║  │   Price Impact: 0.5%                           │     ║
║  └────────────────────────────────────────────────┘     ║
║                                                          ║
║  Expected Profit: $1.40 (2.5% - fees)                  ║
║                                                          ║
║  Execute trade? (yes/no):                              ║
╚══════════════════════════════════════════════════════════╝
```

## State Machine

```
IDLE
  │
  ├─> [Event Received] ──> ANALYZING
  │
ANALYZING
  │
  ├─> [No Opportunity] ──> IDLE
  ├─> [Opportunity Found] ──> SIMULATING
  │
SIMULATING
  │
  ├─> [Simulation Failed] ──> IDLE
  ├─> [Not Profitable] ──> IDLE
  ├─> [Profitable] ──> AWAITING_CONFIRMATION
  │
AWAITING_CONFIRMATION
  │
  ├─> [User Rejected] ──> IDLE
  ├─> [User Confirmed] ──> EXECUTING
  │
EXECUTING
  │
  ├─> [Re-validation Failed] ──> IDLE
  ├─> [Buy Executing] ──> BUY_PENDING
  │
BUY_PENDING
  │
  ├─> [Buy Confirmed] ──> SELL_EXECUTING
  ├─> [Buy Failed] ──> IDLE
  │
SELL_EXECUTING
  │
  ├─> [Sell Executing] ──> SELL_PENDING
  │
SELL_PENDING
  │
  ├─> [Sell Confirmed] ──> COMPLETED
  ├─> [Sell Failed] ──> RECOVERY
  │
COMPLETED
  │
  └─> [Log Results] ──> IDLE
```

## Configuration

### Key Parameters

```typescript
interface ArbitrageConfig {
  // Profit thresholds
  minProfitPercent: number;        // Minimum profit % to execute
  minProfitUsd: number;            // Minimum profit in USD
  
  // Risk management
  maxTradeSizeUsd: number;         // Maximum trade size
  maxPriceImpact: number;          // Maximum acceptable price impact %
  slippageTolerance: number;       // Slippage tolerance %
  
  // Execution
  revalidateBeforeExecute: boolean; // Re-check prices before execution
  staleOpportunityTimeout: number;  // Max age of opportunity (ms)
  executionTimeout: number;         // Max time to wait for execution (ms)
  
  // Gas/Fees
  gasMultiplier: number;            // Gas estimate multiplier (safety)
  priorityFeeMultiplier: number;    // Priority fee multiplier
  
  // Event handling
  eventDebounceMs: number;          // Debounce time for events
  maxConcurrentTrades: number;       // Max concurrent trades (usually 1)
}
```

## Monitoring & Logging

### Key Metrics to Track

1. **Opportunities Detected**: Count of profitable opportunities found
2. **Trades Executed**: Count of trades actually executed
3. **Success Rate**: % of trades that were profitable
4. **Average Profit**: Average profit per trade
5. **Simulation Accuracy**: Difference between simulated and actual results
6. **Gas Costs**: Actual vs estimated gas costs
7. **Price Staleness**: How often prices are stale
8. **Execution Time**: Time from detection to completion

### Logging Levels

- **DEBUG**: Detailed simulation results, event processing
- **INFO**: Opportunities detected, trades executed
- **WARN**: Price staleness, balance warnings, slippage exceeded
- **ERROR**: Execution failures, network errors, simulation failures

## Testing Strategy

### Unit Tests
- Price calculation accuracy
- Simulation logic
- Opportunity detection
- State management

### Integration Tests
- Event listener reliability
- Trade simulation accuracy
- Balance checking
- Transaction building

### End-to-End Tests
- Full arbitrage flow (paper trading)
- Error recovery
- Concurrent event handling
- Network failure scenarios

## Future Enhancements

1. **Multi-token Support**: Monitor multiple token pairs simultaneously
2. **Bridge Integration**: Automatic cross-chain transfers
3. **Machine Learning**: Predict optimal trade sizes based on historical data
4. **Portfolio Management**: Track positions across multiple trades
5. **Advanced Analytics**: Dashboard with charts and metrics
6. **Automated Rebalancing**: Automatic position management

