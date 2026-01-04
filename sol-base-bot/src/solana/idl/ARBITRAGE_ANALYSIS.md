# Pump.fun IDL Analysis for Arbitrage Opportunities

## Executive Summary

This document analyzes the Pump.fun IDL to identify functions, accounts, and events that can be leveraged for building arbitrage detection and execution systems.

---

## 🎯 Critical Functions for Arbitrage

### 1. **Account Fetching Functions** (High Priority)

#### `getBondingCurveAccount(mint: PublicKey)`
**Purpose**: Fetch real-time bonding curve state
**Data Retrieved**:
- `virtual_token_reserves` - Current virtual token reserves
- `virtual_sol_reserves` - Current virtual SOL reserves  
- `real_token_reserves` - Actual token reserves in pool
- `real_sol_reserves` - Actual SOL reserves in pool
- `token_total_supply` - Total token supply
- `complete` - Whether bonding curve is complete (migrated to AMM)
- `creator` - Token creator address
- `is_mayhem_mode` - Special mode flag

**Arbitrage Use Cases**:
- Real-time price calculation
- Liquidity depth analysis
- Detect completion status (affects trading venue)
- Calculate maximum tradeable amounts

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `getGlobalAccount()`
**Purpose**: Fetch global program parameters
**Data Retrieved**:
- `fee_basis_points` - Trading fee percentage
- `creator_fee_basis_points` - Creator fee percentage
- `fee_recipients` - Array of fee recipient addresses
- `reserved_fee_recipients` - Reserved fee recipients
- `pool_migration_fee` - Fee when migrating to AMM
- `initial_virtual_token_reserves` - Initial curve parameters
- `initial_virtual_sol_reserves` - Initial curve parameters
- `token_total_supply` - Total supply constant

**Arbitrage Use Cases**:
- Calculate exact fees for profit estimation
- Understand fee structure for cost modeling
- Detect if migration is enabled (affects strategy)

**Implementation Priority**: ⭐⭐⭐⭐

---

#### `getFeeConfigAccount()`
**Purpose**: Fetch dynamic fee configuration
**Data Retrieved**:
- `flat_fees` - Base fees structure
- `fee_tiers` - Market cap-based fee tiers
  - `market_cap_lamports_threshold` - Threshold for tier
  - `fees.lp_fee_bps` - LP fee basis points
  - `fees.protocol_fee_bps` - Protocol fee basis points
  - `fees.creator_fee_bps` - Creator fee basis points

**Arbitrage Use Cases**:
- Dynamic fee calculation based on market cap
- Accurate profit calculations
- Fee optimization strategies

**Implementation Priority**: ⭐⭐⭐⭐

---

### 2. **Price Calculation Functions** (High Priority)

#### `calculateExactBuyPrice(tokenAmount: bigint, includeFees: boolean)`
**Purpose**: Calculate exact SOL cost for buying tokens
**Formula**: Uses bonding curve with fee adjustments
**Parameters**:
- Account for fees (protocol + creator)
- Account for slippage
- Account for price impact

**Arbitrage Use Cases**:
- Precise entry price calculation
- Profit margin estimation
- Slippage protection

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `calculateExactSellPrice(tokenAmount: bigint, includeFees: boolean)`
**Purpose**: Calculate exact SOL received for selling tokens
**Formula**: Uses bonding curve with fee adjustments
**Parameters**:
- Account for fees
- Account for slippage
- Account for price impact

**Arbitrage Use Cases**:
- Precise exit price calculation
- Profit margin verification
- Risk assessment

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `calculatePriceImpact(tokenAmount: bigint, isBuy: boolean)`
**Purpose**: Calculate price impact for a trade size
**Returns**: Percentage price impact

**Arbitrage Use Cases**:
- Determine optimal trade size
- Avoid trades with excessive slippage
- Calculate maximum profitable trade size

**Implementation Priority**: ⭐⭐⭐⭐

---

#### `calculateMaxTradeableAmount(maxSolSpend: bigint, isBuy: boolean)`
**Purpose**: Calculate maximum tokens tradeable for given SOL budget
**Arbitrage Use Cases**:
- Optimize trade size
- Capital efficiency
- Risk management

**Implementation Priority**: ⭐⭐⭐⭐

---

### 3. **Event Monitoring Functions** (High Priority)

#### `subscribeToTradeEvents(mint?: PublicKey)`
**Purpose**: Real-time trade event monitoring
**Event Data** (`TradeEvent`):
```typescript
{
  mint: PublicKey,
  sol_amount: u64,
  token_amount: u64,
  is_buy: bool,
  user: PublicKey,
  timestamp: i64,
  virtual_sol_reserves: u64,
  virtual_token_reserves: u64,
  real_sol_reserves: u64,
  real_token_reserves: u64,
  fee: u64,
  creator_fee: u64,
  ix_name: "buy" | "sell" | "buy_exact_sol_in"
}
```

**Arbitrage Use Cases**:
- Real-time price updates
- Detect large trades (arbitrage opportunities)
- Monitor market activity
- Track reserve changes instantly

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `subscribeToCompleteEvents()`
**Purpose**: Monitor when bonding curves complete
**Event Data** (`CompleteEvent`):
```typescript
{
  mint: PublicKey,
  bonding_curve: PublicKey,
  timestamp: i64
}
```

**Arbitrage Use Cases**:
- Detect migration to AMM (venue change)
- Stop trading on bonding curve
- Switch to AMM arbitrage strategies

**Implementation Priority**: ⭐⭐⭐⭐

---

### 4. **Liquidity Analysis Functions** (Medium Priority)

#### `getLiquidityDepth(mint: PublicKey)`
**Purpose**: Calculate available liquidity at different price levels
**Returns**:
- Available SOL liquidity
- Available token liquidity
- Liquidity distribution

**Arbitrage Use Cases**:
- Determine tradeable amounts
- Assess market depth
- Risk assessment

**Implementation Priority**: ⭐⭐⭐

---

#### `getBondingCurveProgress(mint: PublicKey)`
**Purpose**: Calculate progress toward completion
**Formula**: Based on real reserves vs total supply
**Returns**: Percentage complete (0-100%)

**Arbitrage Use Cases**:
- Time-sensitive arbitrage (before migration)
- Risk management (avoid near-completion tokens)

**Implementation Priority**: ⭐⭐⭐

---

### 5. **Volume & Analytics Functions** (Medium Priority)

#### `getGlobalVolumeAccumulator(mint: PublicKey)`
**Purpose**: Fetch global volume statistics
**Data Retrieved**:
- `sol_volumes` - Array of daily SOL volumes (30 days)
- `total_token_supply` - Token supply per day
- `start_time` / `end_time` - Time range
- `seconds_in_a_day` - Day definition

**Arbitrage Use Cases**:
- Market activity analysis
- Volume-based strategies
- Trend identification

**Implementation Priority**: ⭐⭐⭐

---

#### `getUserVolumeAccumulator(user: PublicKey)`
**Purpose**: Fetch user-specific volume data
**Data Retrieved**:
- `total_unclaimed_tokens` - Unclaimed incentive tokens
- `total_claimed_tokens` - Claimed tokens
- `current_sol_volume` - User's SOL volume
- `last_update_timestamp` - Last update time

**Arbitrage Use Cases**:
- Track bot's own volume
- Monitor competitor activity
- Fee optimization

**Implementation Priority**: ⭐⭐

---

### 6. **Advanced Trading Functions** (Medium Priority)

#### `buildBuyExactSolInInstruction(spendableSol: bigint, minTokensOut: bigint)`
**Purpose**: Buy with exact SOL budget (from IDL: `buy_exact_sol_in`)
**Features**:
- Spends exact SOL amount
- Guarantees minimum tokens received
- Accounts for rent and fees automatically

**Arbitrage Use Cases**:
- Capital-efficient trading
- Exact budget utilization
- Slippage protection

**Implementation Priority**: ⭐⭐⭐⭐

---

#### `checkBondingCurveComplete(mint: PublicKey)`
**Purpose**: Check if bonding curve is complete
**Returns**: Boolean + migration info if complete

**Arbitrage Use Cases**:
- Pre-trade validation
- Strategy selection
- Error prevention

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

### 7. **Fee Calculation Functions** (High Priority)

#### `calculateTotalFees(solAmount: bigint, mint: PublicKey, isBuy: boolean)`
**Purpose**: Calculate all fees for a trade
**Returns**:
```typescript
{
  protocolFee: bigint,
  creatorFee: bigint,
  lpFee: bigint,
  totalFee: bigint,
  feeBps: number
}
```

**Arbitrage Use Cases**:
- Accurate profit calculations
- Fee optimization
- Cost modeling

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `getFeeTierForMarketCap(marketCapLamports: bigint)`
**Purpose**: Determine fee tier based on market cap
**Returns**: Fee tier structure

**Arbitrage Use Cases**:
- Dynamic fee calculation
- Market cap-based strategies

**Implementation Priority**: ⭐⭐⭐

---

### 8. **Slippage Calculation Functions** (High Priority)

#### `calculateSlippage(tokenAmount: bigint, isBuy: boolean)`
**Purpose**: Calculate expected slippage
**Returns**: Slippage percentage

**Arbitrage Use Cases**:
- Risk assessment
- Trade size optimization
- Profit margin protection

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `calculateOptimalTradeSize(maxSlippage: number, isBuy: boolean)`
**Purpose**: Find optimal trade size for given slippage tolerance
**Returns**: Optimal token amount

**Arbitrage Use Cases**:
- Trade size optimization
- Risk management
- Profit maximization

**Implementation Priority**: ⭐⭐⭐⭐

---

### 9. **Multi-Token Analysis Functions** (High Priority)

#### `batchGetBondingCurves(mints: PublicKey[])`
**Purpose**: Fetch multiple bonding curves efficiently
**Returns**: Array of bonding curve data

**Arbitrage Use Cases**:
- Multi-token monitoring
- Cross-token arbitrage
- Portfolio analysis

**Implementation Priority**: ⭐⭐⭐⭐

---

#### `findArbitrageOpportunities(tokenPairs: Array<{mint1, mint2}>)`
**Purpose**: Scan for arbitrage opportunities between tokens
**Returns**: Array of opportunities with profit estimates

**Arbitrage Use Cases**:
- Cross-token arbitrage
- Opportunity discovery
- Automated scanning

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

### 10. **Real-time Monitoring Functions** (High Priority)

#### `monitorPriceChanges(mint: PublicKey, callback: (price: number) => void)`
**Purpose**: Real-time price monitoring via events
**Implementation**: Uses `TradeEvent` subscription

**Arbitrage Use Cases**:
- Real-time opportunity detection
- Price alert system
- Market monitoring

**Implementation Priority**: ⭐⭐⭐⭐⭐

---

#### `monitorReserveChanges(mint: PublicKey, callback: (reserves: Reserves) => void)`
**Purpose**: Real-time reserve monitoring
**Implementation**: Uses `TradeEvent` subscription

**Arbitrage Use Cases**:
- Liquidity monitoring
- Large trade detection
- Market depth tracking

**Implementation Priority**: ⭐⭐⭐⭐

---

## 📊 Account Structures for Arbitrage

### BondingCurve Account (Critical)
```typescript
interface BondingCurve {
  virtual_token_reserves: u64;    // For price calculation
  virtual_sol_reserves: u64;      // For price calculation
  real_token_reserves: u64;        // Actual liquidity
  real_sol_reserves: u64;          // Actual liquidity
  token_total_supply: u64;         // For completion calculation
  complete: bool;                  // Trading venue indicator
  creator: PublicKey;              // For fee calculations
  is_mayhem_mode: bool;           // Special mode flag
}
```

**Key Metrics to Calculate**:
- Current Price = `virtual_sol_reserves / virtual_token_reserves`
- Available Liquidity = `real_sol_reserves` (for buys) or `real_token_reserves` (for sells)
- Completion Progress = `(token_total_supply - real_token_reserves) / token_total_supply`

---

### Global Account (Important)
```typescript
interface Global {
  fee_basis_points: u64;            // Base trading fee
  creator_fee_basis_points: u64;   // Creator fee
  pool_migration_fee: u64;         // Migration fee
  fee_recipients: PublicKey[7];    // Fee distribution
  // ... other fields
}
```

**Key Metrics**:
- Total Fee % = `fee_basis_points + creator_fee_basis_points`
- Fee Cost = `trade_amount * (total_fee_bps / 10000)`

---

### FeeConfig Account (Important)
```typescript
interface FeeConfig {
  flat_fees: Fees;
  fee_tiers: FeeTier[];
}

interface FeeTier {
  market_cap_lamports_threshold: u128;
  fees: {
    lp_fee_bps: u64;
    protocol_fee_bps: u64;
    creator_fee_bps: u64;
  };
}
```

**Key Metrics**:
- Market Cap = `virtual_sol_reserves * 2 * SOL_PRICE_USD`
- Fee Tier = Find tier where `market_cap >= threshold`
- Dynamic Fees = Use tier fees if applicable

---

## 🎯 Event-Based Opportunities

### TradeEvent (Most Important)
**When**: Emitted on every buy/sell
**Data**: Complete trade information including reserves

**Use Cases**:
1. **Real-time Price Updates**: Update price immediately after each trade
2. **Large Trade Detection**: Detect whale trades that create arbitrage opportunities
3. **Reserve Tracking**: Monitor liquidity changes in real-time
4. **Volume Analysis**: Track trading volume and activity

**Implementation**:
```typescript
connection.onProgramAccountChange(
  PUMP_FUN_PROGRAM,
  (accountInfo) => {
    // Parse TradeEvent from logs
    // Update price cache
    // Check for arbitrage opportunities
  }
);
```

---

### CompleteEvent
**When**: Bonding curve completes and migrates to AMM
**Impact**: Trading venue changes from bonding curve to AMM

**Use Cases**:
1. **Strategy Switch**: Stop bonding curve arbitrage, start AMM arbitrage
2. **Risk Management**: Avoid trading near completion
3. **Migration Detection**: Track when tokens migrate

---

## 🔧 Implementation Recommendations

### Priority 1: Core Functions (Implement First)
1. ✅ `getBondingCurveAccount()` - Already partially implemented
2. ✅ `calculateExactBuyPrice()` - Already implemented (with simulation)
3. ✅ `calculateExactSellPrice()` - Already implemented (with simulation)
4. ⚠️ `subscribeToTradeEvents()` - **NEEDS IMPLEMENTATION**
5. ⚠️ `calculateTotalFees()` - **NEEDS IMPLEMENTATION**
6. ⚠️ `checkBondingCurveComplete()` - **NEEDS IMPLEMENTATION**

### Priority 2: Enhanced Functions
1. `calculatePriceImpact()` - For trade size optimization
2. `getFeeConfigAccount()` - For accurate fee calculation
3. `batchGetBondingCurves()` - For multi-token monitoring
4. `monitorPriceChanges()` - Real-time price updates

### Priority 3: Advanced Functions
1. `findArbitrageOpportunities()` - Automated opportunity discovery
2. `getLiquidityDepth()` - Market depth analysis
3. `getGlobalVolumeAccumulator()` - Volume analytics

---

## 💡 Arbitrage Strategy Considerations

### 1. **Fee-Aware Calculations**
Always account for:
- Protocol fees (from `Global.fee_basis_points`)
- Creator fees (from `Global.creator_fee_basis_points`)
- Dynamic fees (from `FeeConfig` based on market cap)
- Transaction fees (Solana network fees)

### 2. **Slippage Protection**
- Use `max_sol_cost` parameter in `buy()` instruction
- Use `min_sol_output` parameter in `sell()` instruction
- Calculate price impact before trading
- Monitor reserves in real-time

### 3. **Bonding Curve Completion**
- Check `complete` flag before trading
- Monitor `CompleteEvent` for venue changes
- Calculate completion progress to avoid near-completion tokens

### 4. **Real-time Monitoring**
- Subscribe to `TradeEvent` for instant price updates
- Cache bonding curve state locally
- Update prices on every trade event

### 5. **Capital Efficiency**
- Use `buy_exact_sol_in` for exact budget utilization
- Calculate optimal trade sizes
- Consider gas costs in profit calculations

---

## 🚨 Important Notes

1. **Bonding Curve Formula**: Uses constant product formula
   - `virtual_sol_reserves * virtual_token_reserves = constant`
   - Price = `virtual_sol_reserves / virtual_token_reserves`

2. **Fee Structure**: Fees are deducted from trade amounts
   - Buy: You pay more SOL than simple formula suggests
   - Sell: You receive less SOL than simple formula suggests

3. **Reserve Types**:
   - **Virtual Reserves**: Used for price calculation (includes virtual liquidity)
   - **Real Reserves**: Actual tokens/SOL in the pool (tradable amount)

4. **Completion**: When `complete = true`, token has migrated to AMM
   - Bonding curve trading stops
   - Must use AMM for trading

5. **Mayhem Mode**: Special mode flag that may affect trading behavior
   - Check `is_mayhem_mode` before trading
   - May have different fee structures or rules

---

## 📈 Recommended Implementation Order

1. **Phase 1**: Core price and fee calculations
   - Enhance existing pricing functions with fee calculations
   - Add `checkBondingCurveComplete()` validation
   - Add `calculateTotalFees()` function

2. **Phase 2**: Real-time monitoring
   - Implement `subscribeToTradeEvents()`
   - Build price cache that updates on events
   - Add reserve change monitoring

3. **Phase 3**: Advanced analytics
   - Implement `calculatePriceImpact()`
   - Add `getLiquidityDepth()` analysis
   - Build `batchGetBondingCurves()` for multi-token support

4. **Phase 4**: Automation
   - Implement `findArbitrageOpportunities()`
   - Add automated opportunity detection
   - Build alert system for profitable trades

---

## 🔗 Related IDL Instructions

While not directly used for arbitrage, these instructions provide context:

- `buy()` - Standard buy instruction (already implemented)
- `sell()` - Standard sell instruction (already implemented)
- `buy_exact_sol_in()` - Buy with exact SOL budget (recommended for implementation)
- `migrate()` - Migration to AMM (monitor, don't execute)
- `set_params()` - Admin function (read-only for arbitrage)

---

## 📝 Summary

The Pump.fun IDL provides rich data for arbitrage strategies:

**Critical Functions**:
- ✅ Price calculations (partially implemented)
- ⚠️ Real-time event monitoring (needs implementation)
- ⚠️ Fee calculations (needs enhancement)
- ⚠️ Completion status checking (needs implementation)

**High-Value Additions**:
- Event-based price updates
- Accurate fee calculations
- Slippage and price impact analysis
- Multi-token batch operations

**Key Accounts**:
- `BondingCurve` - Price and liquidity data
- `Global` - Fee parameters
- `FeeConfig` - Dynamic fee structure

**Key Events**:
- `TradeEvent` - Real-time price updates
- `CompleteEvent` - Venue change detection

