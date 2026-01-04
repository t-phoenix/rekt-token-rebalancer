import { Contract, JsonRpcProvider, formatUnits, EventLog } from 'ethers';
import uniswapPairAbi from '../abi/UniswapV2Pair.json' with { type: "json" };
import uniswapRouterAbi from '../abi/UniswapRouter02.json' with { type: "json" };
import { getTokenDecimals } from './router.js';

/**
 * SwapEvent interface matching Uniswap V2 Pair Swap event
 */
export interface SwapEvent {
  sender: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  to: string;
  transactionHash: string;
  blockNumber: number;
  blockTimestamp: number;
}

/**
 * Callback function type for swap events
 */
export type SwapEventCallback = (event: SwapEvent) => void;

/**
 * Subscription handle for managing event listeners
 */
export interface SwapEventSubscription {
  unsubscribe: () => void;
}

/**
 * Gets the Uniswap V2 pair address for two tokens
 * Uses the factory's getPair function via the router
 */
export async function getPairAddress(
  provider: JsonRpcProvider,
  routerAddress: string,
  tokenA: string,
  tokenB: string
): Promise<string> {
  try {
    const router = new Contract(routerAddress, uniswapRouterAbi, provider);
    const factoryAddress = await router.factory();
    
    // Uniswap V2 Factory ABI - just the getPair function
    const factoryAbi = [
      {
        inputs: [
          { internalType: 'address', name: 'tokenA', type: 'address' },
          { internalType: 'address', name: 'tokenB', type: 'address' },
        ],
        name: 'getPair',
        outputs: [{ internalType: 'address', name: 'pair', type: 'address' }],
        stateMutability: 'view',
        type: 'function',
      },
    ];
    
    const factory = new Contract(factoryAddress, factoryAbi, provider);
    const pairAddress = await factory.getPair(tokenA, tokenB);
    
    if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Pair does not exist for tokens ${tokenA} and ${tokenB}`);
    }
    
    return pairAddress;
  } catch (err) {
    throw new Error(
      `Failed to get pair address: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Parses a raw event log into a SwapEvent
 */
function parseSwapEvent(
  event: EventLog,
  token0Address: string,
  token1Address: string
): SwapEvent {
  const args = event.args as any;
  
  return {
    sender: args.sender || event.args[0],
    amount0In: BigInt(args.amount0In?.toString() || args[1]?.toString() || '0'),
    amount1In: BigInt(args.amount1In?.toString() || args[2]?.toString() || '0'),
    amount0Out: BigInt(args.amount0Out?.toString() || args[3]?.toString() || '0'),
    amount1Out: BigInt(args.amount1Out?.toString() || args[4]?.toString() || '0'),
    to: args.to || event.args[5],
    transactionHash: event.transactionHash,
    blockNumber: event.blockNumber,
    blockTimestamp: 0, // Will be filled by the subscription handler
  };
}

/**
 * Polls for new swap events by querying recent blocks
 * This is a fallback for RPC providers that don't support WebSocket subscriptions
 */
async function pollForSwapEvents(
  provider: JsonRpcProvider,
  pairAddress: string,
  callback: SwapEventCallback,
  token0Address: string,
  token1Address: string,
  processedTxHashes: Set<string>,
  subscriptionStartBlock: number,
  pollInterval: number = 2000
): Promise<void> {
  try {
    const pairContract = new Contract(pairAddress, uniswapPairAbi, provider);
    const currentBlock = await provider.getBlockNumber();
    
    // Query events from the last few blocks (or from subscription start)
    // Free tier allows max 10 blocks (inclusive), so use currentBlock - 9
    const fromBlock = Math.max(subscriptionStartBlock, currentBlock - 9);
    const toBlock = currentBlock;
    
    // Get all Swap events in the block range
    const filter = pairContract.filters.Swap();
    const events = await pairContract.queryFilter(filter, fromBlock, toBlock);
    
    // Filter out already processed events
    const newEvents = events.filter(
      (e) => !processedTxHashes.has(e.transactionHash)
    );
    
    if (newEvents.length === 0) {
      return; // No new events
    }
    
    // Get block timestamps for new events
    const blockNumbers = new Set(newEvents.map(e => e.blockNumber));
    const blockTimestamps: Map<number, number> = new Map();
    
    // Fetch block timestamps in parallel
    await Promise.all(
      Array.from(blockNumbers).map(async (blockNum) => {
        try {
          const block = await provider.getBlock(blockNum);
          if (block) {
            blockTimestamps.set(blockNum, block.timestamp);
          }
        } catch (err) {
          // Ignore errors fetching block
        }
      })
    );
    
    // Process new events
    for (const event of newEvents) {
      const swapEvent = parseSwapEvent(event as EventLog, token0Address, token1Address);
      swapEvent.blockTimestamp = blockTimestamps.get(event.blockNumber) || 0;
      
      callback(swapEvent);
      processedTxHashes.add(event.transactionHash);
    }
    
    // Clean up old transaction hashes to prevent memory leak
    if (processedTxHashes.size > 5000) {
      const txHashesArray = Array.from(processedTxHashes);
      const toKeep = txHashesArray.slice(-2500); // Keep last 2500
      processedTxHashes.clear();
      toKeep.forEach(tx => processedTxHashes.add(tx));
    }
  } catch (error) {
    console.error('Error polling for swap events:', error);
  }
}

/**
 * Subscribes to Swap events from a Uniswap V2 pair
 * 
 * Automatically uses polling mode for HTTP-only RPC providers (which don't support
 * WebSocket subscriptions). For RPC providers that support WebSockets, it will
 * use real-time event subscriptions.
 * 
 * @param provider - Ethers provider instance
 * @param pairAddress - Address of the Uniswap V2 pair contract
 * @param token0Address - Address of token0 in the pair
 * @param token1Address - Address of token1 in the pair
 * @param callback - Callback function to handle swap events
 * @param pollInterval - Polling interval in ms (default: 2000ms)
 * @param usePollingMode - Use polling mode instead of WebSocket (default: false)
 *                        Set to true to force polling (works with all RPC providers)
 * @returns Subscription handle with unsubscribe method
 */
export function subscribeToSwapEvents(
  provider: JsonRpcProvider,
  pairAddress: string,
  token0Address: string,
  token1Address: string,
  callback: SwapEventCallback,
  pollInterval: number = 2000,
  usePollingMode: boolean = false
): SwapEventSubscription {
  const pairContract = new Contract(pairAddress, uniswapPairAbi, provider);
  
  let isUnsubscribed = false;
  let eventListener: ((...args: any[]) => void) | null = null;
  let pollingActive = false;
  const processedTxHashes = new Set<string>();
  let startBlock = 0;
  
  // Start polling function
  const startPolling = async () => {
    if (pollingActive) return;
    pollingActive = true;
    
    // Get initial start block
    try {
      startBlock = await provider.getBlockNumber();
    } catch (err) {
      console.error('Failed to get start block:', err);
      startBlock = 0;
    }
    
    let pollCount = 0;
    const statusInterval = 10000; // Show status every 10 seconds
    let lastStatusTime = Date.now();
    
    // Initial poll immediately
    await pollForSwapEvents(
      provider,
      pairAddress,
      callback,
      token0Address,
      token1Address,
      processedTxHashes,
      startBlock,
      pollInterval
    );
    
    // Then poll at intervals
    while (!isUnsubscribed) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      if (!isUnsubscribed) {
        pollCount++;
        await pollForSwapEvents(
          provider,
          pairAddress,
          callback,
          token0Address,
          token1Address,
          processedTxHashes,
          startBlock,
          pollInterval
        );
        
        // Show status periodically
        const now = Date.now();
        if (now - lastStatusTime >= statusInterval) {
          console.log(`   [Status] Polling active... (${pollCount} polls, ${processedTxHashes.size} events processed)`);
          lastStatusTime = now;
        }
      }
    }
  };
  
  if (usePollingMode) {
    // Use polling mode (works with all RPC providers)
    console.log('📡 Using polling mode (compatible with all RPC providers)');
    console.log(`   Polling every ${pollInterval}ms`);
    console.log(`   Pair address: ${pairAddress}\n`);
    startPolling();
    
    return {
      unsubscribe: () => {
        isUnsubscribed = true;
        pollingActive = false;
      },
    };
  }
  
  // Try WebSocket subscription (only if provider supports it)
  try {
    // Subscribe to Swap events
    const filter = pairContract.filters.Swap();
    
    eventListener = async (event: EventLog) => {
      if (isUnsubscribed) return;
      
      // Skip if we've already processed this transaction
      if (processedTxHashes.has(event.transactionHash)) {
        return;
      }
      
      try {
        // Get block timestamp
        const block = await provider.getBlock(event.blockNumber);
        const swapEvent = parseSwapEvent(event, token0Address, token1Address);
        swapEvent.blockTimestamp = block?.timestamp || 0;
        
        callback(swapEvent);
        processedTxHashes.add(event.transactionHash);
      } catch (error) {
        console.error('Error processing swap event:', error);
      }
    };
    
    pairContract.on(filter, eventListener);
    
    console.log('✅ Using WebSocket subscription (real-time updates)');
    console.log(`   Pair address: ${pairAddress}\n`);
    
    return {
      unsubscribe: () => {
        isUnsubscribed = true;
        if (eventListener) {
          try {
            pairContract.off(filter, eventListener);
          } catch (error) {
            // Ignore errors when unsubscribing
          }
        }
      },
    };
  } catch (error: any) {
    // WebSocket subscription failed, fall back to polling
    console.warn('⚠️  WebSocket subscription failed, falling back to polling mode');
    console.warn(`   Polling every ${pollInterval}ms\n`);
    startPolling();
    
    return {
      unsubscribe: () => {
        isUnsubscribed = true;
        pollingActive = false;
        // No need to unsubscribe from filter since WebSocket subscription failed
      },
    };
  }
}

/**
 * Helper function to format swap event for display
 */
export async function formatSwapEvent(
  provider: JsonRpcProvider,
  event: SwapEvent,
  token0Address: string,
  token1Address: string
): Promise<string> {
  try {
    const [token0Decimals, token1Decimals] = await Promise.all([
      getTokenDecimals(provider, token0Address),
      getTokenDecimals(provider, token1Address),
    ]);
    
    // Determine swap direction
    const isToken0In = event.amount0In > 0n;
    const isToken1In = event.amount1In > 0n;
    
    let swapType = 'UNKNOWN';
    let amountIn = 0n;
    let amountOut = 0n;
    let tokenInDecimals = 18;
    let tokenOutDecimals = 18;
    let tokenInSymbol = 'TOKEN0';
    let tokenOutSymbol = 'TOKEN1';
    
    if (isToken0In && event.amount1Out > 0n) {
      // Token0 -> Token1 swap
      swapType = 'TOKEN0→TOKEN1';
      amountIn = event.amount0In;
      amountOut = event.amount1Out;
      tokenInDecimals = token0Decimals;
      tokenOutDecimals = token1Decimals;
      tokenInSymbol = 'TOKEN0';
      tokenOutSymbol = 'TOKEN1';
    } else if (isToken1In && event.amount0Out > 0n) {
      // Token1 -> Token0 swap
      swapType = 'TOKEN1→TOKEN0';
      amountIn = event.amount1In;
      amountOut = event.amount0Out;
      tokenInDecimals = token1Decimals;
      tokenOutDecimals = token0Decimals;
      tokenInSymbol = 'TOKEN1';
      tokenOutSymbol = 'TOKEN0';
    }
    
    const amountInFormatted = parseFloat(formatUnits(amountIn, tokenInDecimals));
    const amountOutFormatted = parseFloat(formatUnits(amountOut, tokenOutDecimals));
    
    const timestamp = event.blockTimestamp > 0
      ? new Date(event.blockTimestamp * 1000).toISOString()
      : 'N/A';
    
    return `[${swapType}] Block: ${event.blockNumber} | ` +
           `In: ${amountInFormatted.toFixed(6)} ${tokenInSymbol} | ` +
           `Out: ${amountOutFormatted.toFixed(6)} ${tokenOutSymbol} | ` +
           `To: ${event.to.slice(0, 8)}... | ` +
           `Tx: ${event.transactionHash.slice(0, 10)}... | ` +
           `Time: ${timestamp}`;
  } catch (error) {
    return `[SWAP] Block: ${event.blockNumber} | ` +
           `Tx: ${event.transactionHash.slice(0, 10)}... | ` +
           `Error formatting: ${error instanceof Error ? error.message : String(error)}`;
  }
}

