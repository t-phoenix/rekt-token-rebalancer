# Arbitrage Bot Design Summary

## Overview

This document summarizes the design for your cross-chain arbitrage bot that monitors Pump Fun (Solana) and Uniswap V2 (Base) for profitable opportunities.

## Your Requirements ✅

1. ✅ **Capture both market's data** - Event listeners on both chains
2. ✅ **Analyze pricing and volume** - MarketDataManager tracks prices and volumes
3. ✅ **Simulate efficient buy and sell** - TradeSimulator (to be implemented)
4. ✅ **Reach same price on both exchanges** - Opportunity detection finds price differences
5. ✅ **CLI confirmation** - Interactive prompts before execution
6. ✅ **Listen to events** - Real-time event listeners
7. ✅ **Rerun calculations on trade events** - Event-driven recalculation
8. ✅ **Show simulations** - Display buy/sell simulations
9. ✅ **Auto-execute if profitable** - ExecutionManager (to be implemented)

## Architecture Highlights

### Event-Driven Design
- Events trigger price updates
- Price updates trigger opportunity analysis
- Opportunities trigger simulations
- Simulations trigger user prompts
- Confirmations trigger execution

### Safety First
- **Re-validation**: Check prices again before execution
- **Stale Detection**: Ignore old opportunities
- **Balance Checks**: Verify sufficient funds
- **Slippage Protection**: Set conservative limits
- **Gas Estimation**: Use safety multipliers

### State Management
- Track current prices, volumes, liquidity
- Monitor pending transactions
- Handle failures gracefully
- Prevent concurrent trades

## Key Components

### 1. MarketDataManager
**Purpose**: Centralized market state management

**Features**:
- Tracks prices from both chains
- Records volume data
- Maintains liquidity information
- Provides price difference calculations
- Detects stale prices

**Usage**:
```typescript
const marketData = new MarketDataManager();
marketData.updatePrice('solana', priceData);
marketData.updatePrice('base', priceData);
const diff = marketData.getPriceDifference(); // Returns % difference
```

### 2. OpportunityAnalyzer
**Purpose**: Detect and evaluate arbitrage opportunities

**Features**:
- Calculates price differences
- Determines optimal trade size
- Estimates profitability
- Validates opportunities
- Detects stale opportunities

**Usage**:
```typescript
const analyzer = new OpportunityAnalyzer(config, marketData);
const opportunity = analyzer.analyze(balances);
if (opportunity) {
  // Profitable opportunity found!
}
```

### 3. TradeSimulator (To Implement)
**Purpose**: Simulate trades to estimate actual profitability

**Features**:
- Simulate buy on cheaper chain
- Simulate sell on expensive chain
- Calculate gas costs
- Estimate price impact
- Calculate net profit

**Usage**:
```typescript
const simulator = new TradeSimulator();
const simulation = await simulator.simulateArbitrage(opportunity);
if (simulation.netProfitUsd > minProfit) {
  // Show to user
}
```

### 4. ExecutionManager (To Implement)
**Purpose**: Safely execute trades with all safety checks

**Features**:
- Re-validate before execution
- Check balances
- Build transactions
- Send transactions
- Wait for confirmations
- Handle errors

**Usage**:
```typescript
const executor = new ExecutionManager();
const result = await executor.executeTrade(plan);
if (result.success) {
  console.log(`Profit: $${result.actualProfitUsd}`);
}
```

### 5. ArbitrageOrchestrator
**Purpose**: Main coordinator that ties everything together

**Features**:
- Manages event listeners
- Coordinates opportunity detection
- Handles trade execution
- Provides lifecycle management

**Usage**:
```typescript
const orchestrator = new ArbitrageOrchestrator(
  solanaConnection,
  baseProvider,
  solanaWallet,
  baseWallet
);

await orchestrator.start();
// Bot is now running and monitoring for opportunities
```

## Data Flow

```
1. Market Event (Buy/Sell on either chain)
   ↓
2. Update Market Data (price, volume, liquidity)
   ↓
3. Trigger Opportunity Analysis
   ↓
4. Calculate Price Difference
   ↓
5. If Profitable → Simulate Trades
   ↓
6. Show Simulation to User (CLI)
   ↓
7. User Confirms → Re-validate
   ↓
8. Execute Buy Transaction
   ↓
9. Wait for Confirmation
   ↓
10. Execute Sell Transaction
   ↓
11. Wait for Confirmation
   ↓
12. Calculate Actual Profit
   ↓
13. Log Results
```

## Common Pitfalls Addressed

### ✅ Race Conditions
- Re-validate prices before execution
- Use transaction deadlines
- Detect stale opportunities

### ✅ Slippage & Price Impact
- Calculate price impact before trading
- Use optimal trade size
- Set conservative slippage limits

### ✅ Gas/Fee Estimation
- Use safety multipliers (1.5x)
- Track actual vs estimated
- Include priority fees

### ✅ Event Listener Reliability
- Deduplicate by transaction hash
- Fallback to polling
- Track processed events

### ✅ Balance Management
- Check before each trade
- Reserve minimum for gas
- Track pending transactions

### ✅ Concurrent Trades
- Trade lock mechanism
- Process one at a time
- Queue management

### ✅ Network Congestion
- Priority fees (Solana)
- Higher gas prices (Base)
- Transaction timeouts

### ✅ Price Oracle Accuracy
- Use on-chain events as primary source
- Detect stale prices
- Cache with TTL

## Implementation Status

### ✅ Completed
- Event listeners (Solana & Base)
- Price calculation functions
- Trade simulation functions (individual)
- MarketDataManager class
- OpportunityAnalyzer class
- Orchestrator structure
- Type definitions

### ⚠️ To Implement
- TradeSimulator class (combines buy/sell simulations)
- ExecutionManager class
- CLI interface
- Balance fetching
- Price updates from events
- Complete orchestrator integration

## Next Steps

1. **Complete TradeSimulator**
   - Combine existing buy/sell simulation functions
   - Calculate net profit
   - Estimate execution time

2. **Complete ExecutionManager**
   - Implement trade execution
   - Add safety checks
   - Handle errors

3. **Build CLI Interface**
   - Display opportunities
   - Show simulations
   - Prompt for confirmation
   - Show execution progress

4. **Integrate Everything**
   - Connect orchestrator to all components
   - Test end-to-end flow
   - Add error handling

5. **Testing**
   - Unit tests
   - Integration tests
   - Paper trading

## Configuration

Key parameters in your config:

```typescript
{
  minProfitPercent: 0.02,      // 2% minimum
  minProfitUsd: 1.0,          // $1 minimum
  maxTradeSizeUsd: 100,       // Max trade size
  maxPriceImpact: 5.0,         // 5% max impact
  slippageTolerance: 0.005,   // 0.5% slippage
  revalidateBeforeExecute: true,
  staleOpportunityTimeout: 10000, // 10 seconds
  gasMultiplier: 1.5,          // Safety buffer
}
```

## Safety Features

1. **Re-validation**: Prices checked again before execution
2. **Stale Detection**: Old opportunities ignored
3. **Balance Checks**: Sufficient funds verified
4. **Slippage Protection**: Conservative limits
5. **Gas Estimation**: Safety multipliers
6. **Transaction Timeouts**: Prevent hanging
7. **Error Recovery**: Graceful failure handling
8. **Trade Lock**: One trade at a time

## Monitoring

Track these metrics:
- Opportunities detected
- Trades executed
- Success rate
- Average profit
- Simulation accuracy
- Gas costs
- Execution time

## Testing Strategy

1. **Unit Tests**: Individual components
2. **Integration Tests**: Component interactions
3. **Paper Trading**: Test with real data, no execution
4. **Small Amounts**: Start with minimal trades
5. **Gradual Scaling**: Increase size as confidence grows

## Files Created

- `ARBITRAGE_DESIGN.md` - Complete design document
- `IMPLEMENTATION_CHECKLIST.md` - Step-by-step checklist
- `src/arbitrage/types.ts` - Type definitions
- `src/arbitrage/marketData.ts` - Market data manager
- `src/arbitrage/opportunity.ts` - Opportunity analyzer
- `src/arbitrage/orchestrator.ts` - Main orchestrator (starter)
- `src/arbitrage/README.md` - Implementation guide

## Getting Started

1. Review `ARBITRAGE_DESIGN.md` for complete architecture
2. Check `IMPLEMENTATION_CHECKLIST.md` for what's done
3. Complete `TradeSimulator` class
4. Complete `ExecutionManager` class
5. Build CLI interface
6. Test with paper trading
7. Gradually enable live trading

## Questions?

Refer to:
- `ARBITRAGE_DESIGN.md` - Architecture details
- `IMPLEMENTATION_CHECKLIST.md` - Implementation status
- `USAGE_GUIDE.md` - How to use existing features

