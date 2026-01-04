# Arbitrage Bot - Usage Guide

## Quick Start

This guide will help you set up and run the arbitrage bot to monitor price differences between Pump Fun (Solana) and Uniswap V2 (Base) for the same token.

## Prerequisites

- Node.js v20.x or higher
- npm or pnpm package manager
- Solana RPC endpoint (public or private)
- Base RPC endpoint (public or private)
- Wallets with required balances (see below)

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

Create a `.env` file in the root directory with the following variables:

### Required Configuration

```env
# Token Configuration
TOKEN_KEY=YOUR_TOKEN_SYMBOL

# Solana Configuration
SOLANA_RPC_HTTP_URL=https://api.mainnet-beta.solana.com
SOLANA_TOKEN_MINT=YOUR_SOLANA_TOKEN_MINT_ADDRESS
SOLANA_PRICE_SOURCE=pumpfun
SOLANA_SOL_PRICE_USD=200

# Base Configuration
BASE_RPC_HTTP_URL=https://mainnet.base.org
BASE_TOKEN_ADDRESS=YOUR_BASE_TOKEN_ADDRESS
BASE_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
BASE_PRICE_SOURCE=uniswap-v2-router02
UNISWAP_V2_ROUTER02_ADDRESS=0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24

# Wallet Configuration (for balance checking and trading)
SOLANA_PRIVATE_KEY=YOUR_BASE58_PRIVATE_KEY
BASE_PRIVATE_KEY_HEX=YOUR_HEX_PRIVATE_KEY
```

### Optional Configuration

```env
# Trading Parameters
MIN_PROFIT_THRESHOLD=0.02  # 2% minimum profit
TRADE_SIZE_USD=100         # Trade size in USD
PRICE_POLL_INTERVAL_MS=500  # Polling interval in milliseconds

# Run Mode
RUN_MODE=paper  # 'paper' for testing, 'live' for actual trading
LOG_LEVEL=info  # 'debug', 'info', 'warn', 'error'
```

## Wallet Requirements

### Solana Wallet
- **SOL**: Minimum 0.1 SOL (for transaction fees)
- **TOKEN**: Variable (depends on trading strategy)
- **Note**: Pump Fun uses SOL as the base currency for swaps

### Base Wallet
- **ETH**: Minimum 0.01 ETH (for gas fees)
- **USDC**: Minimum 10 USDC (for token purchases)
- **TOKEN**: Variable (depends on trading strategy)
- **Note**: Uniswap V2 Router uses USDC as the quote currency

## Usage

### 1. Test Pricing and Balances

Before running the main bot, test that pricing and wallet balances are working correctly:

```bash
npm run test:pricing
```

This will:
- Check wallet balances on both chains
- Test Pump Fun price fetching
- Test Base Uniswap V2 price fetching
- Compare prices and show arbitrage opportunities

### 2. Run the Bot

Start the bot in development mode (with auto-reload):

```bash
npm run dev
```

Or run the built version:

```bash
npm start
```

The bot will:
- Monitor prices on both chains
- Check wallet balances at startup
- Log price updates
- Detect and log arbitrage opportunities

### 3. Monitor Output

The bot logs the following information:

- **Price Updates**: Real-time price updates from both chains
- **Opportunities**: Detected arbitrage opportunities with profit calculations
- **Balance Warnings**: Low balance alerts
- **Errors**: Any errors during price fetching or balance checks

Example output:
```
{"level":"info","message":"bot:started","runMode":"paper","pollIntervalMs":500}
{"level":"info","message":"price:update","chain":"solana","priceUsd":"0.00012345"}
{"level":"info","message":"price:update","chain":"base","priceUsd":"0.00012500"}
{"level":"info","message":"opportunity:detected","direction":"SOLANA_TO_BASE","expectedProfitPercent":0.0125}
```

## Understanding the Price Sources

### Pump Fun (Solana)
- Uses **SOL** as the base currency
- Price is calculated from bonding curve reserves
- Formula: `priceUsd = (virtual_sol_reserves / virtual_token_reserves) * SOL_PRICE_USD`

### Uniswap V2 Router (Base)
- Uses **USDC** as the quote currency
- Price is fetched from Uniswap V2 Router02 contract
- Uses `getAmountsOut` to calculate token price in USDC

## Troubleshooting

### Balance Check Fails
- Ensure private keys are correctly formatted
- Solana private key should be base58 encoded in JSON array format
- Base private key should be hex format (with or without 0x prefix)
- Verify RPC endpoints are accessible

### Price Fetching Fails
- Check RPC endpoint URLs are correct
- Verify token addresses are valid
- For Base, ensure Uniswap V2 Router02 address is correct
- Check network connectivity

### No Opportunities Detected
- Verify both price sources are working
- Check that `MIN_PROFIT_THRESHOLD` is not too high
- Ensure token addresses match the same token on both chains

## Safety Notes

⚠️ **Important**: 
- The bot is currently in **paper trading mode** by default
- Set `RUN_MODE=live` and `ENABLE_LIVE_TRADING=true` only when ready
- Always test with small amounts first
- Monitor wallet balances regularly
- Keep sufficient ETH on Base for gas fees
- Keep sufficient SOL on Solana for transaction fees

## Next Steps

1. Run `npm run test:pricing` to verify setup
2. Monitor the bot output for opportunities
3. Review detected opportunities before enabling live trading
4. Gradually increase trade sizes as confidence grows

## Support

For issues or questions:
- Check the logs for error messages
- Verify all configuration values are correct
- Ensure wallet balances meet minimum requirements
- Review the main README.md for architecture details

