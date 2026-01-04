import { loadConfig } from '../../config.js';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPumpFunProgram, deriveBondingCurvePDA } from '../pumpfun/anchor.js';
import { getCoinData } from '../pumpfun/api.js';
import { createConnection } from '../utils.js';
import { formatTable } from '../../utils/formatters.js';
import { printHeader, printFooter, logError, handleTestError } from '../../utils/testHelpers.js';

interface PoolInfo {
  // Bonding Curve Account Data (from on-chain)
  bondingCurve: {
    virtualTokenReserves: bigint;
    virtualSolReserves: bigint;
    realTokenReserves: bigint;
    realSolReserves: bigint;
    tokenTotalSupply: bigint;
    complete: boolean;
    creator: PublicKey;
    isMayhemMode: boolean;
  };
  // API Data (from PumpFun API)
  apiData: {
    virtualSolReserves: bigint;
    virtualTokenReserves: bigint;
    complete: boolean;
    [key: string]: any;
  };
  // Calculated Metrics
  metrics: {
    currentPrice: number; // SOL per token
    currentPriceUsd: number;
    marketCap: number;
    liquidity: number; // Real SOL reserves
    liquidityUsd: number;
    priceImpact1M: number; // Price impact for 1M token trade
    priceImpact10M: number; // Price impact for 10M token trade
  };
}

async function getPoolInfo(mint: PublicKey, connection: Connection, program: any): Promise<PoolInfo | null> {
  try {
    // Derive bonding curve PDA
    const [bondingCurvePDA] = deriveBondingCurvePDA(mint);

    // Fetch bonding curve account from on-chain
    console.log(`   Fetching bonding curve account: ${bondingCurvePDA.toBase58()}...`);
    const bondingCurveAccount = await (program.account as any).bondingCurve.fetch(bondingCurvePDA);

    // Fetch coin data from API
    console.log(`   Fetching coin data from PumpFun API...`);
    const coinData = await getCoinData(mint.toBase58());
    if (!coinData) {
      throw new Error('Failed to fetch coin data from PumpFun API');
    }

    // Extract bonding curve data
    const virtualTokenReserves = BigInt(bondingCurveAccount.virtualTokenReserves.toString());
    const virtualSolReserves = BigInt(bondingCurveAccount.virtualSolReserves.toString());
    const realTokenReserves = BigInt(bondingCurveAccount.realTokenReserves.toString());
    const realSolReserves = BigInt(bondingCurveAccount.realSolReserves.toString());
    const tokenTotalSupply = BigInt(bondingCurveAccount.tokenTotalSupply.toString());

    // Get API data
    const apiVirtualSol = BigInt(coinData['virtual_sol_reserves']);
    const apiVirtualToken = BigInt(coinData['virtual_token_reserves']);

    // Calculate current price (SOL per token)
    const currentPrice = Number(virtualSolReserves) / Number(virtualTokenReserves);
    const config = loadConfig();
    const currentPriceUsd = currentPrice * config.SOLANA_SOL_PRICE_USD;

    // Calculate market cap (total supply * current price)
    const marketCap = Number(tokenTotalSupply) * currentPrice;
    const marketCapUsd = marketCap * config.SOLANA_SOL_PRICE_USD;

    // Calculate liquidity (real SOL reserves)
    const liquidity = Number(realSolReserves) / LAMPORTS_PER_SOL;
    const liquidityUsd = liquidity * config.SOLANA_SOL_PRICE_USD;

    // Calculate price impact for different trade sizes
    const calculatePriceImpact = (tokenAmount: bigint, isBuy: boolean): number => {
      const constant = virtualSolReserves * virtualTokenReserves;
      let newVToken: bigint;
      
      if (isBuy) {
        newVToken = virtualTokenReserves - tokenAmount;
        if (newVToken <= 0n) return Infinity;
      } else {
        newVToken = virtualTokenReserves + tokenAmount;
      }
      
      const newVSol = constant / newVToken;
      const newPrice = Number(newVSol) / Number(newVToken);
      return ((newPrice - currentPrice) / currentPrice) * 100;
    };

    const priceImpact1M = calculatePriceImpact(1_000_000n, true);
    const priceImpact10M = calculatePriceImpact(10_000_000n, true);

    return {
      bondingCurve: {
        virtualTokenReserves,
        virtualSolReserves,
        realTokenReserves,
        realSolReserves,
        tokenTotalSupply,
        complete: bondingCurveAccount.complete,
        creator: bondingCurveAccount.creator,
        isMayhemMode: bondingCurveAccount.isMayhemMode || false,
      },
      apiData: {
        virtualSolReserves: apiVirtualSol,
        virtualTokenReserves: apiVirtualToken,
        complete: coinData['complete'] || false,
        ...coinData,
      },
      metrics: {
        currentPrice,
        currentPriceUsd,
        marketCap: marketCapUsd,
        liquidity,
        liquidityUsd,
        priceImpact1M,
        priceImpact10M,
      },
    };
  } catch (error) {
    logError(error, 'Error fetching pool info');
    return null;
  }
}

async function testPoolInfo() {
  const config = loadConfig();

  printHeader('🏊 ARBITRAGE BOT - POOL INFORMATION');

  // Get token address
  const solanaMint = config.SOLANA_TOKEN_MINT || config.SOLANA_TOKEN_MINTS?.split(',')[0]?.trim();
  if (!solanaMint) {
    throw new Error('Missing SOLANA_TOKEN_MINT or SOLANA_TOKEN_MINTS');
  }

  const mint = new PublicKey(solanaMint);
  console.log(`📋 Token Configuration:`);
  console.log(`   Token Mint: ${mint.toBase58()}`);
  console.log(`   SOL Price (USD): $${config.SOLANA_SOL_PRICE_USD}\n`);

  // Setup connection and program
  const connection = createConnection(config.SOLANA_RPC_HTTP_URL);
  const program = createPumpFunProgram(connection);

  // Fetch pool information
  console.log('📊 Fetching Pool Information...\n');
  const poolInfo = await getPoolInfo(mint, connection, program);

  if (!poolInfo) {
    throw new Error('Failed to fetch pool information');
  }

  // Display Bonding Curve Account Data
  console.log('='.repeat(70));
  console.log('📈 BONDING CURVE ACCOUNT (On-Chain Data)');
  console.log('='.repeat(70) + '\n');

  const bondingCurveHeaders = ['Field', 'Value'];
  const bondingCurveRows = [
    ['Bonding Curve PDA', deriveBondingCurvePDA(mint)[0].toBase58()],
    ['Virtual SOL Reserves', `${(Number(poolInfo.bondingCurve.virtualSolReserves) / LAMPORTS_PER_SOL).toFixed(9)} SOL`],
    ['Virtual Token Reserves', `${Number(poolInfo.bondingCurve.virtualTokenReserves).toLocaleString()} tokens`],
    ['Real SOL Reserves', `${(Number(poolInfo.bondingCurve.realSolReserves) / LAMPORTS_PER_SOL).toFixed(9)} SOL`],
    ['Real Token Reserves', `${Number(poolInfo.bondingCurve.realTokenReserves).toLocaleString()} tokens`],
    ['Token Total Supply', `${Number(poolInfo.bondingCurve.tokenTotalSupply).toLocaleString()} tokens`],
    ['Complete (Migrated)', poolInfo.bondingCurve.complete ? '✅ Yes' : '❌ No'],
    ['Mayhem Mode', poolInfo.bondingCurve.isMayhemMode ? '✅ Yes' : '❌ No'],
    ['Creator', poolInfo.bondingCurve.creator.toBase58()],
  ];

  console.log(formatTable(bondingCurveHeaders, bondingCurveRows));

  // Display API Data Comparison
  console.log('\n' + '='.repeat(70));
  console.log('🌐 PUMPFUN API DATA');
  console.log('='.repeat(70) + '\n');

  const apiHeaders = ['Field', 'Value'];
  const apiRows = [
    ['Virtual SOL Reserves (API)', `${(Number(poolInfo.apiData.virtualSolReserves) / LAMPORTS_PER_SOL).toFixed(9)} SOL`],
    ['Virtual Token Reserves (API)', `${Number(poolInfo.apiData.virtualTokenReserves).toLocaleString()} tokens`],
    ['Complete (API)', poolInfo.apiData.complete ? '✅ Yes' : '❌ No'],
  ];

  // Check if on-chain and API data match
  const solMatch = poolInfo.bondingCurve.virtualSolReserves === poolInfo.apiData.virtualSolReserves;
  const tokenMatch = poolInfo.bondingCurve.virtualTokenReserves === poolInfo.apiData.virtualTokenReserves;

  if (!solMatch || !tokenMatch) {
    console.log('⚠️  WARNING: On-chain data does not match API data!');
    console.log(`   SOL Reserves Match: ${solMatch ? '✅' : '❌'}`);
    console.log(`   Token Reserves Match: ${tokenMatch ? '✅' : '❌'}\n`);
  }

  console.log(formatTable(apiHeaders, apiRows));

  // Display Calculated Metrics
  console.log('\n' + '='.repeat(70));
  console.log('💰 CALCULATED METRICS');
  console.log('='.repeat(70) + '\n');

  const metricsHeaders = ['Metric', 'Value'];
  const metricsRows = [
    ['Current Price', `${poolInfo.metrics.currentPrice.toExponential(6)} SOL/token`],
    ['Current Price (USD)', `$${poolInfo.metrics.currentPriceUsd.toExponential(6)}/token`],
    ['Market Cap (USD)', `$${poolInfo.metrics.marketCap.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
    ['Liquidity (Real SOL)', `${poolInfo.metrics.liquidity.toFixed(9)} SOL`],
    ['Liquidity (USD)', `$${poolInfo.metrics.liquidityUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
    ['Price Impact (1M tokens)', `${poolInfo.metrics.priceImpact1M.toFixed(4)}%`],
    ['Price Impact (10M tokens)', `${poolInfo.metrics.priceImpact10M.toFixed(4)}%`],
  ];

  console.log(formatTable(metricsHeaders, metricsRows));

  // Display Additional API Data (if available)
  if (poolInfo.apiData.name || poolInfo.apiData.symbol) {
    console.log('\n' + '='.repeat(70));
    console.log('📝 TOKEN METADATA (API)');
    console.log('='.repeat(70) + '\n');

    const metadataHeaders = ['Field', 'Value'];
    const metadataRows: string[][] = [];
    
    if (poolInfo.apiData.name) metadataRows.push(['Name', poolInfo.apiData.name]);
    if (poolInfo.apiData.symbol) metadataRows.push(['Symbol', poolInfo.apiData.symbol]);
    if (poolInfo.apiData.description) metadataRows.push(['Description', poolInfo.apiData.description.substring(0, 100) + '...']);
    if (poolInfo.apiData.image_uri) metadataRows.push(['Image URI', poolInfo.apiData.image_uri]);
    if (poolInfo.apiData.uri) metadataRows.push(['URI', poolInfo.apiData.uri]);
    if (poolInfo.apiData.created_timestamp) {
      const date = new Date(poolInfo.apiData.created_timestamp * 1000);
      metadataRows.push(['Created', date.toISOString()]);
    }

    if (metadataRows.length > 0) {
      console.log(formatTable(metadataHeaders, metadataRows));
    }
  }

  printFooter('✅ Pool Information Retrieved Successfully');

  process.exit(0);
}

testPoolInfo().catch(handleTestError);

