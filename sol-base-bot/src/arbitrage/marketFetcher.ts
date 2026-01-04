import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { JsonRpcProvider, Contract } from 'ethers';
import { getCoinData } from '../solana/pumpfun/api.js';
import { getPairAddress } from '../base/uniswap/events.js';
import { getTokenDecimals } from '../base/uniswap/router.js';
import { createPumpFunProgram } from '../solana/pumpfun/anchor.js';
import { buildBuyInstruction } from '../solana/pumpfun/instructions.js';
import { createTransaction, simulateTransaction } from '../solana/pumpfun/transactions.js';
import { getPriceFetcher } from '../utils/priceFetcher.js';

export interface MarketStats {
  solana: {
    price: number;
    priceUsd: number;
    liquidity: number;
    liquidityUsd: number;
    marketCapUsd: number;
    virtualSolReserves: bigint;
    virtualTokenReserves: bigint;
    realSolReserves: bigint;
    realTokenReserves: bigint;
    tokenDecimals: number;
  };
  base: {
    price: number;
    priceUsd: number;
    liquidity: number;
    liquidityUsd: number;
    usdcReserves: bigint;
    tokenReserves: bigint;
    usdcDecimals: number;
    tokenDecimals: number;
  };
}

/**
 * Price breakdown from simulation
 */
interface TokenPriceBreakdown {
  totalCostSOL: number;      // Total SOL spent (including gas)
  gasFeeSOL: number;          // Transaction gas fee
  actualAmountSOL: number;    // Actual SOL spent on tokens (excluding gas)
  pricePerTokenSOL: number;  // Price per token (same as actualAmountSOL for 1 token)
}

/**
 * Simulate buying 1 token to get the actual SOL cost with breakdown
 * This uses the same simulation approach as test-token-buy.ts
 */
async function simulateTokenPrice(
  solanaConnection: Connection,
  tokenMint: string,
  priorityFeeSol: number,
  keypair?: Keypair
): Promise<TokenPriceBreakdown | null> {
  try {
    // Use provided keypair or create a dummy one for simulation
    // If using real keypair, simulation will be more accurate
    const payer = keypair || Keypair.generate();
    const mint = new PublicKey(tokenMint);

    // For 1 token = 1e6 raw units (6 decimals for PumpFun tokens)
    const ONE_TOKEN_RAW_UNITS = BigInt(1e6);
    // Set a high max SOL cost to avoid slippage errors (we just want to see the actual cost)
    const maxSolCostLamports = BigInt(1e8); // 0.1 SOL max

    // Create program instance
    const program = createPumpFunProgram(solanaConnection, payer);

    // Build buy instruction
    const instruction = await buildBuyInstruction(
      program,
      solanaConnection,
      mint,
      payer.publicKey,
      ONE_TOKEN_RAW_UNITS,
      maxSolCostLamports,
      false // trackVolume
    );

    // Create transaction
    const transaction = await createTransaction(
      solanaConnection,
      [instruction],
      payer.publicKey,
      priorityFeeSol
    );
    transaction.sign(payer);

    // Simulate transaction
    const simulation = await simulateTransaction(solanaConnection, transaction, payer);

    // Check for errors
    if (simulation.value.err) {
      console.warn('⚠️  Simulation failed for price calculation:', simulation.value.err);
      return null;
    }

    // Extract SOL cost and fee breakdown from simulation (same logic as displaySimulationResults)
    const preBalances = (simulation.value as any).preBalances as number[] | undefined;
    const postBalances = (simulation.value as any).postBalances as number[] | undefined;
    const fee = (simulation.value as any).fee as number | undefined;

    if (preBalances && postBalances) {
      const message = transaction.compileMessage();
      const accountKeys = message.accountKeys;
      const payerAddress = payer.publicKey.toBase58();

      for (let i = 0; i < Math.max(preBalances.length, postBalances.length); i++) {
        const accountAddress = accountKeys && accountKeys[i] ? accountKeys[i].toBase58() : '';
        if (accountAddress === payerAddress) {
          const preBalanceSOL = preBalances[i] / LAMPORTS_PER_SOL;
          const postBalanceSOL = postBalances[i] / LAMPORTS_PER_SOL;
          const totalCostSOL = preBalanceSOL - postBalanceSOL;

          // Extract gas fee
          const gasFeeSOL = fee ? fee / LAMPORTS_PER_SOL : 0;

          // Calculate actual SOL spent on tokens (excluding gas)
          const actualAmountSOL = totalCostSOL - gasFeeSOL;

          // Return price breakdown
          return {
            totalCostSOL,
            gasFeeSOL,
            actualAmountSOL,
            pricePerTokenSOL: actualAmountSOL, // For 1 token, this is the price per token
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error simulating token price:', error);
    return null;
  }
}

/**
 * Fetch market data from both Solana and Base chains
 */
export async function fetchMarketData(
  config: {
    SOLANA_TOKEN_MINT: string;
    BASE_TOKEN_ADDRESS: string;
    BASE_USDC_ADDRESS: string;
    SOLANA_SOL_PRICE_USD: number;
    SOLANA_PRIORITY_FEE_SOL?: number;
    UNISWAP_V2_ROUTER02_ADDRESS: string;
    COINMARKETCAP_API_KEY: string;
  },
  solanaConnection: Connection,
  baseProvider: JsonRpcProvider,
  solanaKeypair?: Keypair | null
): Promise<MarketStats | null> {
  try {
    // Fetch Solana market data
    const coinData = await getCoinData(config.SOLANA_TOKEN_MINT);
    //console.log('coinData', coinData);

    if (!coinData) {
      throw new Error('Failed to fetch Solana coin data');
    }

    // Ensure proper conversion from API response (might be string or number)
    // Virtual reserves are used for price calculation (includes virtual liquidity from bonding curve)
    const vSolValue = coinData['virtual_sol_reserves'];
    const vTokenValue = coinData['virtual_token_reserves'];
    const virtualSolReserves = BigInt(typeof vSolValue === 'string' ? vSolValue : String(vSolValue));
    const virtualTokenReserves = BigInt(typeof vTokenValue === 'string' ? vTokenValue : String(vTokenValue));

    // Real reserves are used for liquidity calculations (actual tradable amounts)
    const rSolValue = coinData['real_sol_reserves'];
    const rTokenValue = coinData['real_token_reserves'];
    const realSolReserves = BigInt(typeof rSolValue === 'string' ? rSolValue : String(rSolValue));
    const realTokenReserves = BigInt(typeof rTokenValue === 'string' ? rTokenValue : String(rTokenValue));

    if (virtualSolReserves <= 0n || virtualTokenReserves <= 0n) {
      throw new Error('Invalid Solana virtual reserves');
    }

    if (realSolReserves <= 0n || realTokenReserves <= 0n) {
      throw new Error('Invalid Solana real reserves');
    }

    // Calculate price by simulating 1 token buy to get actual SOL cost
    // This accounts for bonding curve mechanics, fees, and gives accurate price
    // Use real keypair if provided (more accurate simulation), otherwise use dummy
    const priorityFeeSol = config.SOLANA_PRIORITY_FEE_SOL ?? 0;
    const simulatedPriceBreakdown = await simulateTokenPrice(
      solanaConnection,
      config.SOLANA_TOKEN_MINT,
      priorityFeeSol,
      solanaKeypair || undefined
    );

    // Use simulated price if available, otherwise fall back to formula-based calculation
    let solanaPrice: number;
    // Get token decimals (usually 6 for PumpFun)
    const solanaTokenDecimals = 6;

    if (simulatedPriceBreakdown !== null) {
      solanaPrice = simulatedPriceBreakdown.pricePerTokenSOL;

    } else {
      // Correct formula: (vSol / 1e9) / (vToken / 10^decimals)
      const vSolNorm = Number(virtualSolReserves) / LAMPORTS_PER_SOL;
      const vTokenNorm = Number(virtualTokenReserves) / (10 ** solanaTokenDecimals);
      solanaPrice = vSolNorm / vTokenNorm;
      console.log('⚠️  Using formula-based price calculation (simulation unavailable)');
    }
    // Get SOL price from CoinMarketCap if available, otherwise use config
    let solPriceUsd = config.SOLANA_SOL_PRICE_USD;
    if (config.COINMARKETCAP_API_KEY) {
      try {
        const priceFetcher = getPriceFetcher();
        solPriceUsd = await priceFetcher.getSolPrice();
      } catch (error) {
        console.warn('⚠️  Failed to fetch SOL price, using config value:', error);
      }
    }

    const solanaPriceUsd = solanaPrice * solPriceUsd;

    // Liquidity calculation uses REAL reserves (this is the actual available liquidity for trading)
    const solanaLiquidity = Number(realSolReserves) / LAMPORTS_PER_SOL;
    const solanaLiquidityUsd = solanaLiquidity * solPriceUsd;

    // Calculate market cap USD (use API value if available, otherwise calculate from total supply)
    let marketCapUsd: number;
    if (coinData['usd_market_cap'] !== undefined) {
      marketCapUsd = typeof coinData['usd_market_cap'] === 'string'
        ? parseFloat(coinData['usd_market_cap'])
        : Number(coinData['usd_market_cap']);
    } else {
      // Fallback: calculate from total supply and price
      const totalSupply = coinData['total_supply']
        ? (typeof coinData['total_supply'] === 'string'
          ? BigInt(coinData['total_supply'])
          : BigInt(coinData['total_supply']))
        : null;
      if (totalSupply) {
        const SOLANA_TOKEN_DECIMALS = 9;
        const totalSupplyTokens = Number(totalSupply) / (10 ** SOLANA_TOKEN_DECIMALS);
        marketCapUsd = totalSupplyTokens * solanaPriceUsd;
      } else {
        marketCapUsd = 0;
      }
    }

    // Fetch Base market data
    const pairAddress = await getPairAddress(
      baseProvider,
      config.UNISWAP_V2_ROUTER02_ADDRESS,
      config.BASE_USDC_ADDRESS,
      config.BASE_TOKEN_ADDRESS
    );

    const uniswapPairAbi = [
      'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
      'function token0() view returns (address)',
      'function token1() view returns (address)',
    ];

    const pairContract = new Contract(pairAddress, uniswapPairAbi, baseProvider);
    const [reserve0, reserve1] = await pairContract.getReserves();
    const token0Address = await pairContract.token0();

    const isUsdcToken0 = token0Address.toLowerCase() === config.BASE_USDC_ADDRESS.toLowerCase();
    // Convert BigInt reserves to string first, then to BigInt to ensure proper handling
    const reserve0Str = typeof reserve0 === 'bigint' ? reserve0.toString() : String(reserve0);
    const reserve1Str = typeof reserve1 === 'bigint' ? reserve1.toString() : String(reserve1);
    const usdcReserves = BigInt(isUsdcToken0 ? reserve0Str : reserve1Str);
    const tokenReserves = BigInt(isUsdcToken0 ? reserve1Str : reserve0Str);

    if (usdcReserves <= 0n || tokenReserves <= 0n) {
      throw new Error('Invalid Base reserves');
    }

    // Get token decimals
    const [usdcDecimals, tokenDecimals] = await Promise.all([
      getTokenDecimals(baseProvider, config.BASE_USDC_ADDRESS),
      getTokenDecimals(baseProvider, config.BASE_TOKEN_ADDRESS),
    ]);

    // Ensure decimals are numbers
    const usdcDecimalsNum = Number(usdcDecimals);
    const tokenDecimalsNum = Number(tokenDecimals);

    // Convert BigInt to Number for calculations
    const usdcReservesNum = Number(usdcReserves);
    const tokenReservesNum = Number(tokenReserves);

    // Calculate price with proper decimal adjustment
    const decimalAdjustment = 10 ** (tokenDecimalsNum - usdcDecimalsNum);
    const basePrice = (usdcReservesNum / tokenReservesNum) * decimalAdjustment;
    const basePriceUsd = basePrice; // Assuming USDC is $1
    const baseLiquidity = usdcReservesNum / (10 ** usdcDecimalsNum);
    const baseLiquidityUsd = baseLiquidity; // Assuming USDC is $1

    return {
      solana: {
        price: solanaPrice,
        priceUsd: solanaPriceUsd,
        liquidity: solanaLiquidity,
        liquidityUsd: solanaLiquidityUsd,
        marketCapUsd,
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
        tokenDecimals: tokenDecimalsNum,
      },
      base: {
        price: basePrice,
        priceUsd: basePriceUsd,
        liquidity: baseLiquidity,
        liquidityUsd: baseLiquidityUsd,
        usdcReserves,
        tokenReserves,
        usdcDecimals: usdcDecimalsNum,
        tokenDecimals: tokenDecimalsNum,
      },
    };
  } catch (error) {
    console.error('Error fetching market data:', error);
    return null;
  }
}

