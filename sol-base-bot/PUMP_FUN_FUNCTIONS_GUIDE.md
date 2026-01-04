# Pump Fun IDL Functions Guide

This document explains the main functions available in the Pump Fun program, their signatures, inputs, and how to use them.

## Program Address
- **Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`

---

## Main Trading Functions

### 1. `buy` - Buy Tokens from Bonding Curve

**Purpose**: Purchases tokens from a bonding curve using SOL.

**Function Signature**:
```typescript
buy(
  amount: u64,           // Amount of tokens to buy
  max_sol_cost: u64,     // Maximum SOL willing to spend (slippage protection)
  track_volume: OptionBool // Whether to track volume for incentives
)
```

**Accounts Required** (15 accounts):
1. `global` - Global state PDA (seeds: `["global"]`)
2. `fee_recipient` - Fee recipient account (writable)
3. `mint` - Token mint address
4. `bonding_curve` - Bonding curve PDA (seeds: `["bonding-curve", mint]`) (writable)
5. `associated_bonding_curve` - Associated token account for bonding curve (writable)
6. `associated_user` - User's associated token account (writable)
7. `user` - User's wallet (writable, signer)
8. `system_program` - System program (`11111111111111111111111111111111`)
9. `token_program` - Token program
10. `creator_vault` - Creator vault PDA (seeds: `["creator-vault", creator]`) (writable)
11. `event_authority` - Event authority PDA (seeds: `["__event_authority"]`)
12. `program` - Pump Fun program (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`)
13. `global_volume_accumulator` - Global volume accumulator PDA
14. `user_volume_accumulator` - User volume accumulator PDA (writable)
15. `fee_config` - Fee config PDA
16. `fee_program` - Fee program (`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`)

**Example Usage**:
```typescript
const instruction = await program.methods
  .buy(
    new BN(tokenAmount.toString()),      // amount: tokens to buy
    new BN(maxSolCost.toString()),       // max_sol_cost: max SOL to spend
    { some: trackVolume }                 // track_volume: OptionBool
  )
  .accounts({
    global,
    feeRecipient: FEE_RECIPIENT,
    mint,
    bondingCurve,
    associatedBondingCurve,
    associatedUser,
    user,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    creatorVault,
    eventAuthority,
    program: PUMP_FUN_PROGRAM,
    globalVolumeAccumulator,
    userVolumeAccumulator,
    feeConfig,
    feeProgram: FEE_PROGRAM,
  })
  .instruction();
```

**Errors**:
- `TooMuchSolRequired` (6002): Slippage exceeded - too much SOL required
- `BuyZeroAmount` (6020): Cannot buy zero tokens
- `NotEnoughTokensToBuy` (6021): Insufficient tokens available
- `BuyNotEnoughSolToCoverRent` (6040): Not enough SOL for rent exemption
- `BuyNotEnoughSolToCoverFees` (6041): Not enough SOL for fees

---

### 2. `buy_exact_sol_in` - Buy with Exact SOL Budget

**Purpose**: Given a budget of spendable SOL, buy at least `min_tokens_out`. Account creation and fees are deducted from the spendable SOL.

**Function Signature**:
```typescript
buy_exact_sol_in(
  spendable_sol_in: u64,    // Total SOL budget (including rent + fees)
  min_tokens_out: u64,       // Minimum tokens expected (slippage protection)
  track_volume: OptionBool   // Whether to track volume
)
```

**Accounts Required**: Same as `buy` (15 accounts)

**Key Differences from `buy`**:
- You specify SOL input instead of token output
- Automatically handles account creation costs
- `min_tokens_out = 1` means max slippage
- Must ensure SOL budget covers:
  - `creator_vault` rent (if not created)
  - `user_volume_accumulator` rent (if not created)

**Example Usage**:
```typescript
const instruction = await program.methods
  .buyExactSolIn(
    new BN(spendableSolIn.toString()),    // Total SOL budget
    new BN(minTokensOut.toString()),      // Min tokens expected
    { some: trackVolume }
  )
  .accounts({ /* same as buy */ })
  .instruction();
```

**Errors**: Same as `buy`, plus:
- `BuySlippageBelowMinTokensOut` (6042): Would receive fewer tokens than `min_tokens_out`

---

### 3. `sell` - Sell Tokens to Bonding Curve

**Purpose**: Sells tokens back to the bonding curve for SOL.

**Function Signature**:
```typescript
sell(
  amount: u64,              // Amount of tokens to sell
  min_sol_output: u64       // Minimum SOL expected (slippage protection)
)
```

**Accounts Required** (13 accounts):
1. `global` - Global state PDA
2. `fee_recipient` - Fee recipient (writable)
3. `mint` - Token mint
4. `bonding_curve` - Bonding curve PDA (writable)
5. `associated_bonding_curve` - Associated bonding curve ATA (writable)
6. `associated_user` - User's ATA (writable)
7. `user` - User wallet (writable, signer)
8. `system_program` - System program
9. `creator_vault` - Creator vault PDA (writable)
10. `token_program` - Token program
11. `event_authority` - Event authority PDA
12. `program` - Pump Fun program
13. `fee_config` - Fee config PDA
14. `fee_program` - Fee program

**Example Usage**:
```typescript
const instruction = await program.methods
  .sell(
    new BN(tokenAmount.toString()),      // amount: tokens to sell
    new BN(minSolOutput.toString())      // min_sol_output: min SOL expected
  )
  .accounts({
    global,
    feeRecipient: FEE_RECIPIENT,
    mint,
    bondingCurve,
    associatedBondingCurve,
    associatedUser,
    user,
    systemProgram: SystemProgram.programId,
    creatorVault,
    tokenProgram: TOKEN_PROGRAM_ID,
    eventAuthority,
    program: PUMP_FUN_PROGRAM,
    feeConfig,
    feeProgram: FEE_PROGRAM,
  })
  .instruction();
```

**Errors**:
- `TooLittleSolReceived` (6003): Slippage exceeded - too little SOL received
- `SellZeroAmount` (6022): Cannot sell zero tokens
- `NotEnoughTokensToSell` (6023): Insufficient token balance

---

## Token Creation Functions

### 4. `create` - Create New Token and Bonding Curve

**Purpose**: Creates a new SPL token and its bonding curve.

**Function Signature**:
```typescript
create(
  name: string,        // Token name
  symbol: string,     // Token symbol
  uri: string,        // Metadata URI
  creator: pubkey      // Creator address
)
```

**Accounts Required** (13 accounts):
- `mint` - New mint (writable, signer)
- `mint_authority` - Mint authority PDA
- `bonding_curve` - Bonding curve PDA (writable)
- `associated_bonding_curve` - Associated bonding curve ATA (writable)
- `global` - Global state PDA
- `mpl_token_metadata` - Metaplex token metadata program
- `metadata` - Metadata PDA
- `user` - Creator wallet (writable, signer)
- `system_program` - System program
- `token_program` - Token program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)
- `associated_token_program` - Associated token program
- `rent` - Rent sysvar
- `event_authority` - Event authority PDA
- `program` - Pump Fun program

**Errors**:
- `NameTooLong` (6043)
- `SymbolTooLong` (6044)
- `UriTooLong` (6045)

---

### 5. `create_v2` - Create SPL-22 Token

**Purpose**: Creates a new SPL-22 token (Token-2022) and bonding curve.

**Function Signature**:
```typescript
create_v2(
  name: string,
  symbol: string,
  uri: string,
  creator: pubkey,
  is_mayhem_mode: bool  // Enable mayhem mode
)
```

**Accounts Required**: Similar to `create` but uses Token-2022 program and includes Mayhem program accounts.

**Errors**:
- `CreateV2Disabled` (6046): Create v2 is disabled
- `MayhemModeDisabled` (6048): Mayhem mode is disabled

---

## Migration Function

### 6. `migrate` - Migrate to Pump AMM

**Purpose**: Migrates liquidity from bonding curve to Pump AMM when bonding curve is complete.

**Function Signature**:
```typescript
migrate()  // No arguments
```

**Accounts Required**: ~20+ accounts including:
- Global state
- Bonding curve accounts
- Pump AMM pool accounts
- Token accounts
- Authority accounts

**Errors**:
- `BondingCurveNotComplete` (6006): Bonding curve must be complete first
- `DisabledMigrate` (6018): Migration is disabled

---

## Admin Functions

### 7. `set_params` - Set Global Parameters

**Purpose**: Updates global state parameters (admin only).

**Function Signature**:
```typescript
set_params(
  initial_virtual_token_reserves: u64,
  initial_virtual_sol_reserves: u64,
  initial_real_token_reserves: u64,
  token_total_supply: u64,
  fee_basis_points: u64,
  withdraw_authority: pubkey,
  enable_migrate: bool,
  pool_migration_fee: u64,
  creator_fee_basis_points: u64,
  set_creator_authority: pubkey,
  admin_set_creator_authority: pubkey
)
```

---

## Account Structures

### BondingCurve Account
```typescript
{
  virtual_token_reserves: u64,
  virtual_sol_reserves: u64,
  real_token_reserves: u64,
  real_sol_reserves: u64,
  token_total_supply: u64,
  complete: bool,              // Whether bonding curve is complete
  creator: pubkey,
  is_mayhem_mode: bool
}
```

### Global Account
```typescript
{
  initialized: bool,
  authority: pubkey,
  fee_recipient: pubkey,
  initial_virtual_token_reserves: u64,
  initial_virtual_sol_reserves: u64,
  initial_real_token_reserves: u64,
  token_total_supply: u64,
  fee_basis_points: u64,
  withdraw_authority: pubkey,
  enable_migrate: bool,
  pool_migration_fee: u64,
  creator_fee_basis_points: u64,
  fee_recipients: [pubkey; 7],
  set_creator_authority: pubkey,
  admin_set_creator_authority: pubkey,
  create_v2_enabled: bool,
  whitelist_pda: pubkey,
  reserved_fee_recipient: pubkey,
  mayhem_mode_enabled: bool,
  reserved_fee_recipients: [pubkey; 7]
}
```

---

## Pricing Formula

The bonding curve uses a constant product formula:

**Buy Price Calculation**:
```
solIn = (tokenOut * virtual_sol_reserves) / virtual_token_reserves
```

**Sell Price Calculation**:
```
solOut = (tokenIn * virtual_sol_reserves) / virtual_token_reserves
```

**Note**: Actual prices include fees, so the formulas above are approximations. Use simulation for accurate pricing.

---

## Best Practices

1. **Always use slippage protection**: Set `max_sol_cost` for buys and `min_sol_output` for sells
2. **Simulate transactions first**: Use `simulateTransaction` to estimate costs before executing
3. **Handle account creation**: Ensure accounts exist or have SOL for rent
4. **Check bonding curve status**: Verify `complete` is `false` before trading
5. **Track volume optionally**: Set `track_volume` to `true` only if you want to participate in incentives
6. **Use `buy_exact_sol_in` for fixed budgets**: Better when you have a fixed SOL amount

---

## Common Errors and Solutions

| Error Code | Name | Solution |
|------------|------|----------|
| 6002 | TooMuchSolRequired | Increase `max_sol_cost` or reduce `amount` |
| 6003 | TooLittleSolReceived | Decrease `min_sol_output` or reduce `amount` |
| 6005 | BondingCurveComplete | Token has migrated to AMM, use different DEX |
| 6020 | BuyZeroAmount | Ensure `amount > 0` |
| 6021 | NotEnoughTokensToBuy | Reduce `amount` or check bonding curve reserves |
| 6040 | BuyNotEnoughSolToCoverRent | Add more SOL for account creation |
| 6042 | BuySlippageBelowMinTokensOut | Reduce `min_tokens_out` or increase `spendable_sol_in` |

---

## Example: Complete Buy Flow

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { createPumpFunProgram, buildBuyInstruction } from './pumpfun';

async function buyTokens(
  connection: Connection,
  payer: Keypair,
  mintAddress: string,
  tokenAmount: number,
  maxSolCost: number
) {
  // 1. Create program instance
  const program = createPumpFunProgram(connection, payer);
  
  // 2. Convert to proper types
  const mint = new PublicKey(mintAddress);
  const tokenOut = BigInt(Math.floor(tokenAmount));
  const maxSolCostLamports = BigInt(Math.floor(maxSolCost * 1e9));
  
  // 3. Build instruction
  const instruction = await buildBuyInstruction(
    program,
    connection,
    mint,
    payer.publicKey,
    tokenOut,
    maxSolCostLamports,
    false // trackVolume
  );
  
  // 4. Create and send transaction
  const transaction = new Transaction().add(instruction);
  const signature = await connection.sendTransaction(
    transaction,
    [payer],
    { skipPreflight: false }
  );
  
  // 5. Confirm transaction
  await connection.confirmTransaction(signature);
  
  return signature;
}
```

---

## Additional Resources

- **Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- **Fee Program**: `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`
- **Token Program**: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- **Associated Token Program**: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`

