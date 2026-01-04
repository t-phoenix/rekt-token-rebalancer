import { loadConfig } from '../../config.js';
import { Contract, JsonRpcProvider, formatUnits } from 'ethers';
import { createBaseProvider } from '../baseBalanceUtils.js';
import { getPairAddress } from '../uniswap/events.js';
import { getTokenDecimals } from '../uniswap/router.js';
import { formatTable } from '../../utils/formatters.js';
import { printHeader, printFooter, logError, handleTestError } from '../../utils/testHelpers.js';
import uniswapPairAbi from '../abi/UniswapV2Pair.json' with { type: 'json' };
import erc20Abi from '../abi/ERC20.json' with { type: 'json' };

interface PoolInfo {
  // Pair Contract Data (on-chain)
  pair: {
    address: string;
    token0: string;
    token1: string;
    reserve0: bigint;
    reserve1: bigint;
    blockTimestampLast: number;
    totalSupply: bigint; // LP token supply
  };
  // Token0 Information
  token0Info: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
  };
  // Token1 Information
  token1Info: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: bigint;
  };
  // Calculated Metrics
  metrics: {
    currentPrice: number; // Token1 per Token0 (if USDC is token0, this is tokens per USDC)
    currentPriceInverse: number; // Token0 per Token1 (USDC per token)
    liquidityUsd: number; // Total liquidity in USD (assuming token0 is USDC)
    kValue: bigint; // Constant product (reserve0 * reserve1)
    priceImpact1Token: number; // Price impact for 1 token trade
    priceImpact10Tokens: number; // Price impact for 10 tokens trade
  };
}

async function getPoolInfo(
  provider: JsonRpcProvider,
  routerAddress: string,
  usdcAddress: string,
  tokenAddress: string
): Promise<PoolInfo | null> {
  try {
    // Get pair address
    console.log(`   Finding Uniswap V2 pair...`);
    const pairAddress = await getPairAddress(provider, routerAddress, usdcAddress, tokenAddress);
    console.log(`   Pair Address: ${pairAddress}`);

    // Create pair contract instance
    const pairContract = new Contract(pairAddress, uniswapPairAbi, provider);

    // Fetch pair data
    console.log(`   Fetching pair reserves...`);
    const [reserve0, reserve1, blockTimestampLast] = await pairContract.getReserves();
    const token0Address = await pairContract.token0();
    const token1Address = await pairContract.token1();
    const totalSupply = await pairContract.totalSupply();
    
    // Ensure reserves are BigInt (ethers.js returns bigint, but TypeScript may infer differently)
    const reserve0BigInt = BigInt(reserve0.toString());
    const reserve1BigInt = BigInt(reserve1.toString());

    // Determine which token is which
    const isUsdcToken0 = token0Address.toLowerCase() === usdcAddress.toLowerCase();
    const usdcInfo = isUsdcToken0
      ? { address: token0Address, reserve: reserve0BigInt }
      : { address: token1Address, reserve: reserve1BigInt };
    const tokenInfo = isUsdcToken0
      ? { address: token1Address, reserve: reserve1BigInt }
      : { address: token0Address, reserve: reserve0BigInt };

    // Fetch token information
    console.log(`   Fetching token information...`);
    const [token0Contract, token1Contract] = [
      new Contract(token0Address, erc20Abi, provider),
      new Contract(token1Address, erc20Abi, provider),
    ];

    const [token0Name, token0Symbol, token0Decimals, token0TotalSupply] = await Promise.all([
      token0Contract.name().catch(() => 'Unknown'),
      token0Contract.symbol().catch(() => 'UNKNOWN'),
      token0Contract.decimals().catch(() => 18),
      token0Contract.totalSupply().catch(() => 0n),
    ]);

    const [token1Name, token1Symbol, token1Decimals, token1TotalSupply] = await Promise.all([
      token1Contract.name().catch(() => 'Unknown'),
      token1Contract.symbol().catch(() => 'UNKNOWN'),
      token1Contract.decimals().catch(() => 18),
      token1Contract.totalSupply().catch(() => 0n),
    ]);

    // Calculate current price
    // Price = reserve1 / reserve0 (token1 per token0)
    // If USDC is token0, this gives tokens per USDC
    const reserve0Num = Number(reserve0BigInt);
    const reserve1Num = Number(reserve1BigInt);
    const currentPrice = reserve0Num > 0 ? reserve1Num / reserve0Num : 0;
    const currentPriceInverse = reserve1Num > 0 ? reserve0Num / reserve1Num : 0;

    // Calculate liquidity in USD (assuming token0 is USDC)
    const usdcReserve = isUsdcToken0 ? reserve0BigInt : reserve1BigInt;
    const usdcDecimals = isUsdcToken0 ? token0Decimals : token1Decimals;
    const liquidityUsd = parseFloat(formatUnits(usdcReserve, usdcDecimals)) * 2; // *2 because both sides

    // Calculate constant product (k = x * y)
    const kValue = reserve0BigInt * reserve1BigInt;

    // Calculate price impact for different trade sizes
    // For Uniswap V2: using constant product formula k = x * y
    // When buying with USDC amount, new reserves maintain k constant
    const calculatePriceImpact = (usdcAmount: bigint): number => {
      try {
        if (isUsdcToken0) {
          // USDC is token0, token is token1
          // Buying: adding USDC (reserve0 increases), removing tokens (reserve1 decreases)
          const newReserve0 = reserve0BigInt + usdcAmount;
          const newReserve1 = (reserve0BigInt * reserve1BigInt) / newReserve0; // k = reserve0 * reserve1
          const newPrice = Number(newReserve0) > 0 ? Number(newReserve1) / Number(newReserve0) : 0;
          return ((newPrice - currentPrice) / currentPrice) * 100;
        } else {
          // Token is token0, USDC is token1
          // Buying: adding USDC (reserve1 increases), removing tokens (reserve0 decreases)
          const newReserve1 = reserve1BigInt + usdcAmount;
          const newReserve0 = (reserve0BigInt * reserve1BigInt) / newReserve1;
          if (newReserve0 <= 0n) return Infinity;
          const newPrice = Number(newReserve0) > 0 ? Number(newReserve1) / Number(newReserve0) : 0;
          return ((newPrice - currentPrice) / currentPrice) * 100;
        }
      } catch (error) {
        return 0;
      }
    };

    // Calculate price impact for buying with 1 USDC and 10 USDC
    // Use BigInt operations to avoid precision loss
    const oneUsdc = BigInt(10) ** BigInt(usdcDecimals);
    const tenUsdc = oneUsdc * 10n;

    const priceImpact1Token = calculatePriceImpact(oneUsdc);
    const priceImpact10Tokens = calculatePriceImpact(tenUsdc);

    return {
      pair: {
        address: pairAddress,
        token0: token0Address,
        token1: token1Address,
        reserve0: reserve0BigInt,
        reserve1: reserve1BigInt,
        blockTimestampLast: Number(blockTimestampLast),
        totalSupply,
      },
      token0Info: {
        address: token0Address,
        name: token0Name,
        symbol: token0Symbol,
        decimals: token0Decimals,
        totalSupply: token0TotalSupply,
      },
      token1Info: {
        address: token1Address,
        name: token1Name,
        symbol: token1Symbol,
        decimals: token1Decimals,
        totalSupply: token1TotalSupply,
      },
      metrics: {
        currentPrice,
        currentPriceInverse,
        liquidityUsd,
        kValue,
        priceImpact1Token,
        priceImpact10Tokens,
      },
    };
  } catch (error) {
    logError(error, 'Error fetching pool info');
    return null;
  }
}

async function testPoolInfo() {
  const config = loadConfig();

  printHeader('🏊 ARBITRAGE BOT - BASE POOL INFORMATION (UNISWAP V2)');

  // Validate required configuration
  if (!config.BASE_RPC_HTTP_URL) {
    throw new Error('Missing BASE_RPC_HTTP_URL in environment variables');
  }

  if (!config.UNISWAP_V2_ROUTER02_ADDRESS) {
    throw new Error('Missing UNISWAP_V2_ROUTER02_ADDRESS in environment variables');
  }

  if (!config.BASE_USDC_ADDRESS) {
    throw new Error('Missing BASE_USDC_ADDRESS in environment variables');
  }

  if (!config.BASE_TOKEN_ADDRESS) {
    throw new Error('Missing BASE_TOKEN_ADDRESS in environment variables');
  }

  console.log(`📋 Configuration:`);
  console.log(`   Base RPC URL:           ${config.BASE_RPC_HTTP_URL}`);
  console.log(`   Router Address:         ${config.UNISWAP_V2_ROUTER02_ADDRESS}`);
  console.log(`   USDC Address:           ${config.BASE_USDC_ADDRESS}`);
  console.log(`   Token Address:          ${config.BASE_TOKEN_ADDRESS}\n`);

  // Setup provider
  const provider = createBaseProvider(config.BASE_RPC_HTTP_URL);

  // Fetch pool information
  console.log('📊 Fetching Pool Information...\n');
  const poolInfo = await getPoolInfo(
    provider,
    config.UNISWAP_V2_ROUTER02_ADDRESS,
    config.BASE_USDC_ADDRESS,
    config.BASE_TOKEN_ADDRESS
  );

  if (!poolInfo) {
    throw new Error('Failed to fetch pool information');
  }

  // Determine token order
  const isUsdcToken0 =
    poolInfo.pair.token0.toLowerCase() === config.BASE_USDC_ADDRESS.toLowerCase();
  const usdcInfo = isUsdcToken0 ? poolInfo.token0Info : poolInfo.token1Info;
  const tokenInfo = isUsdcToken0 ? poolInfo.token1Info : poolInfo.token0Info;
  const usdcReserve = isUsdcToken0 ? poolInfo.pair.reserve0 : poolInfo.pair.reserve1;
  const tokenReserve = isUsdcToken0 ? poolInfo.pair.reserve1 : poolInfo.pair.reserve0;

  // Display Pair Information
  console.log('='.repeat(70));
  console.log('📈 UNISWAP V2 PAIR INFORMATION');
  console.log('='.repeat(70) + '\n');

  const pairHeaders = ['Field', 'Value'];
  const pairRows = [
    ['Pair Address', poolInfo.pair.address],
    ['Token0 Address', poolInfo.pair.token0],
    ['Token1 Address', poolInfo.pair.token1],
    ['LP Token Supply', formatUnits(poolInfo.pair.totalSupply, 18)],
    ['Last Update Block', poolInfo.pair.blockTimestampLast.toString()],
  ];

  console.log(formatTable(pairHeaders, pairRows));

  // Display Token0 Information
  console.log('\n' + '='.repeat(70));
  console.log(`🪙 TOKEN0 INFORMATION (${poolInfo.token0Info.symbol})`);
  console.log('='.repeat(70) + '\n');

  const token0Headers = ['Field', 'Value'];
  const token0Rows = [
    ['Address', poolInfo.token0Info.address],
    ['Name', poolInfo.token0Info.name],
    ['Symbol', poolInfo.token0Info.symbol],
    ['Decimals', poolInfo.token0Info.decimals.toString()],
    ['Total Supply', formatUnits(poolInfo.token0Info.totalSupply, poolInfo.token0Info.decimals)],
    [
      'Reserve in Pair',
      formatUnits(isUsdcToken0 ? poolInfo.pair.reserve0 : poolInfo.pair.reserve1, poolInfo.token0Info.decimals),
    ],
  ];

  console.log(formatTable(token0Headers, token0Rows));

  // Display Token1 Information
  console.log('\n' + '='.repeat(70));
  console.log(`🪙 TOKEN1 INFORMATION (${poolInfo.token1Info.symbol})`);
  console.log('='.repeat(70) + '\n');

  const token1Headers = ['Field', 'Value'];
  const token1Rows = [
    ['Address', poolInfo.token1Info.address],
    ['Name', poolInfo.token1Info.name],
    ['Symbol', poolInfo.token1Info.symbol],
    ['Decimals', poolInfo.token1Info.decimals.toString()],
    ['Total Supply', formatUnits(poolInfo.token1Info.totalSupply, poolInfo.token1Info.decimals)],
    [
      'Reserve in Pair',
      formatUnits(isUsdcToken0 ? poolInfo.pair.reserve1 : poolInfo.pair.reserve0, poolInfo.token1Info.decimals),
    ],
  ];

  console.log(formatTable(token1Headers, token1Rows));

  // Display Pool Reserves
  console.log('\n' + '='.repeat(70));
  console.log('💰 POOL RESERVES');
  console.log('='.repeat(70) + '\n');

  const reservesHeaders = ['Token', 'Reserve Amount', 'Reserve (Formatted)'];
  const reservesRows = [
    [
      `${usdcInfo.symbol} (${isUsdcToken0 ? 'Token0' : 'Token1'})`,
      usdcReserve.toString(),
      formatUnits(usdcReserve, usdcInfo.decimals),
    ],
    [
      `${tokenInfo.symbol} (${isUsdcToken0 ? 'Token1' : 'Token0'})`,
      tokenReserve.toString(),
      formatUnits(tokenReserve, tokenInfo.decimals),
    ],
  ];

  console.log(formatTable(reservesHeaders, reservesRows));

  // Display Calculated Metrics
  console.log('\n' + '='.repeat(70));
  console.log('📊 CALCULATED METRICS');
  console.log('='.repeat(70) + '\n');

  const metricsHeaders = ['Metric', 'Value'];
  const metricsRows = [
    [
      `Current Price (${tokenInfo.symbol} per ${usdcInfo.symbol})`,
      poolInfo.metrics.currentPrice.toExponential(6),
    ],
    [
      `Current Price (${usdcInfo.symbol} per ${tokenInfo.symbol})`,
      poolInfo.metrics.currentPriceInverse.toExponential(6),
    ],
    ['Liquidity (USD)', `$${poolInfo.metrics.liquidityUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
    ['Constant Product (k)', poolInfo.metrics.kValue.toString()],
    [`Price Impact (1 ${usdcInfo.symbol} buy)`, `${poolInfo.metrics.priceImpact1Token.toFixed(4)}%`],
    [`Price Impact (10 ${usdcInfo.symbol} buy)`, `${poolInfo.metrics.priceImpact10Tokens.toFixed(4)}%`],
  ];

  console.log(formatTable(metricsHeaders, metricsRows));

  // Display Price Information
  console.log('\n' + '='.repeat(70));
  console.log('💵 PRICE INFORMATION');
  console.log('='.repeat(70) + '\n');

  const priceHeaders = ['Description', 'Value'];
  const priceRows = [
    [
      `1 ${usdcInfo.symbol} =`,
      `${poolInfo.metrics.currentPrice.toFixed(6)} ${tokenInfo.symbol}`,
    ],
    [
      `1 ${tokenInfo.symbol} =`,
      `${poolInfo.metrics.currentPriceInverse.toFixed(6)} ${usdcInfo.symbol}`,
    ],
  ];

  console.log(formatTable(priceHeaders, priceRows));

  printFooter('✅ Pool Information Retrieved Successfully');

  process.exit(0);
}

testPoolInfo().catch(handleTestError);

