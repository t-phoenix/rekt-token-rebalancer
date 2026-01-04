import { Connection, PublicKey } from '@solana/web3.js';
import { EventParser } from '@coral-xyz/anchor';
import { PUMP_FUN_PROGRAM } from '../constants.js';
import { createPumpFunProgram, deriveBondingCurvePDA } from './anchor.js';

/**
 * TradeEvent interface matching the IDL structure
 */
export interface TradeEvent {
  mint: PublicKey;
  solAmount: bigint;
  tokenAmount: bigint;
  isBuy: boolean;
  user: PublicKey;
  timestamp: bigint;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  feeRecipient: PublicKey;
  feeBasisPoints: bigint;
  fee: bigint;
  creator: PublicKey;
  creatorFeeBasisPoints: bigint;
  creatorFee: bigint;
  trackVolume: boolean;
  totalUnclaimedTokens: bigint;
  totalClaimedTokens: bigint;
  currentSolVolume: bigint;
  lastUpdateTimestamp: bigint;
  ixName: string; // "buy" | "sell" | "buy_exact_sol_in"
}

/**
 * Callback function type for trade events
 */
export type TradeEventCallback = (event: TradeEvent, signature: string) => void;

/**
 * Subscription handle for managing event listeners
 */
export interface TradeEventSubscription {
  unsubscribe: () => void;
}

/**
 * Parses a raw Anchor event data into a TradeEvent
 */
function parseTradeEvent(eventData: any): TradeEvent | null {
  try {
    if (!eventData) {
      return null;
    }

    // Handle BN.js objects from Anchor (convert to string then to BigInt)
    const toBigInt = (value: any): bigint => {
      if (value === null || value === undefined) return BigInt(0);
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number') return BigInt(value);
      // Handle BN.js objects
      if (value && typeof value.toString === 'function') {
        return BigInt(value.toString());
      }
      return BigInt(String(value));
    };

    return {
      mint: new PublicKey(eventData.mint),
      solAmount: toBigInt(eventData.solAmount),
      tokenAmount: toBigInt(eventData.tokenAmount),
      isBuy: eventData.isBuy === true || eventData.isBuy === 1,
      user: new PublicKey(eventData.user),
      timestamp: toBigInt(eventData.timestamp),
      virtualSolReserves: toBigInt(eventData.virtualSolReserves),
      virtualTokenReserves: toBigInt(eventData.virtualTokenReserves),
      realSolReserves: toBigInt(eventData.realSolReserves),
      realTokenReserves: toBigInt(eventData.realTokenReserves),
      feeRecipient: new PublicKey(eventData.feeRecipient),
      feeBasisPoints: toBigInt(eventData.feeBasisPoints),
      fee: toBigInt(eventData.fee),
      creator: new PublicKey(eventData.creator),
      creatorFeeBasisPoints: toBigInt(eventData.creatorFeeBasisPoints),
      creatorFee: toBigInt(eventData.creatorFee),
      trackVolume: eventData.trackVolume === true || eventData.trackVolume === 1,
      totalUnclaimedTokens: toBigInt(eventData.totalUnclaimedTokens),
      totalClaimedTokens: toBigInt(eventData.totalClaimedTokens),
      currentSolVolume: toBigInt(eventData.currentSolVolume),
      lastUpdateTimestamp: toBigInt(eventData.lastUpdateTimestamp),
      ixName: eventData.ixName || 'unknown',
    };
  } catch (error) {
    console.error('Error parsing TradeEvent:', error);
    return null;
  }
}

/**
 * Polls for new transactions and extracts trade events
 * This is a fallback for RPC providers that don't support WebSocket subscriptions
 */
async function pollForTradeEvents(
  connection: Connection,
  callback: TradeEventCallback,
  mint: PublicKey | undefined,
  eventParser: EventParser,
  processedSignatures: Set<string>,
  subscriptionStartTime: number,
  pollInterval: number = 2000
): Promise<void> {
  try {
    // If mint is provided, query the bonding curve account for that specific token
    // This is much more efficient than querying all program transactions
    // Otherwise, query all program transactions
    const queryAddress = mint 
      ? deriveBondingCurvePDA(mint)[0]  // Use bonding curve PDA for specific token
      : PUMP_FUN_PROGRAM;                // Use program for all tokens

    // Get recent signatures for the address (most recent first)
    const signatures = await connection.getSignaturesForAddress(
      queryAddress,
      {
        limit: 20, // Get more transactions to catch up if we missed any
      },
      'confirmed'
    );

    if (signatures.length === 0) {
      return; // No new transactions
    }

    // Filter out transactions that happened before subscription started
    // We'll check the block time to determine if transaction is new
    const currentTime = Date.now() / 1000; // Convert to seconds

    // Process signatures in order (newest first, but we'll process all new ones)
    let newEventsFound = 0;
    let newTransactions = 0;
    for (const sigInfo of signatures) {
      // Skip if we've already processed this signature
      if (processedSignatures.has(sigInfo.signature)) {
        continue;
      }

      // Check if transaction happened after subscription started
      // blockTime is Unix timestamp in seconds
      if (sigInfo.blockTime) {
        const txTime = sigInfo.blockTime * 1000; // Convert to milliseconds
        if (txTime < subscriptionStartTime) {
          // Transaction is older than subscription start, skip it
          processedSignatures.add(sigInfo.signature);
          continue;
        }
      }

      newTransactions++;

      if (sigInfo.err) {
        processedSignatures.add(sigInfo.signature); // Mark as processed even if failed
        continue;
      }

      try {
        // Fetch the transaction
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.meta || tx.meta.err) {
          processedSignatures.add(sigInfo.signature);
          continue;
        }

        // Parse events from transaction logs
        let foundTradeEvent = false;
        if (tx.meta.logMessages && tx.meta.logMessages.length > 0) {
          try {
            const events = eventParser.parseLogs(tx.meta.logMessages);

            for (const event of events) {
              //console.log('Event:', event);
              if (event.name === 'tradeEvent') {
                foundTradeEvent = true;

                const tradeEvent = parseTradeEvent(event.data);

                if (tradeEvent) {
                  // If we queried by bonding curve, the mint should already match
                  // But double-check to be safe
                  if (mint && !tradeEvent.mint.equals(mint)) {
                    // Still mark as processed even if filtered out
                    continue;
                  }
                  // console.log('TradeEvent SEARCHING FOR HERE:', tradeEvent);

                  // Call the callback
                  newEventsFound++;
                  callback(tradeEvent, sigInfo.signature);
                }
              }
            }
          } catch (parseError: any) {
            console.error('Error parsing TradeEvent:', parseError);
            // Event parsing failed - this might be a non-trade transaction
            // or the logs might not contain Anchor events
            // This is normal for non-trade transactions, so we silently continue
          }
        }

        // Always mark as processed, even if no events found
        // (transaction might not be a trade, or might be a different instruction)
        processedSignatures.add(sigInfo.signature);
      } catch (error) {
        // Skip transactions that can't be fetched/parsed
        processedSignatures.add(sigInfo.signature);
        continue;
      }
    }

    // Clean up old signatures from the set to prevent memory leak
    // Keep only the most recent 1000 signatures
    if (processedSignatures.size > 1000) {
      const sigsArray = Array.from(processedSignatures);
      const toKeep = sigsArray.slice(-500); // Keep last 500
      processedSignatures.clear();
      toKeep.forEach(sig => processedSignatures.add(sig));
    }

    // Debug output (only if we found new transactions but no events, or if we found events)
    if (newTransactions > 0 && newEventsFound === 0) {
      // Found transactions but no events - might be non-trade transactions
    }
  } catch (error) {
    console.error('Error polling for events:', error);
  }
}


/**
 * Subscribes to trade events from the Pump Fun program
 * 
 * Automatically uses polling mode for HTTP-only RPC providers (which don't support
 * WebSocket subscriptions). For RPC providers that support WebSockets, it will
 * use real-time subscriptions.
 * 
 * @param connection - Solana connection instance
 * @param callback - Callback function to handle trade events
 * @param mint - Optional mint address to filter events for a specific token
 * @param pollInterval - Polling interval in ms (default: 2000ms)
 * @param usePollingMode - Use polling mode instead of WebSocket (default: true)
 *                        Set to false to try WebSocket (requires RPC provider support)
 * @returns Subscription handle with unsubscribe method
 */
export function subscribeToTradeEvents(
  connection: Connection,
  callback: TradeEventCallback,
  mint?: PublicKey,
  pollInterval: number = 2000,
  usePollingMode: boolean = true
): TradeEventSubscription {
  // Create a program instance for event parsing
  const program = createPumpFunProgram(connection);
  const eventParser = new EventParser(PUMP_FUN_PROGRAM, program.coder);

  let isUnsubscribed = false;
  let subscriptionId: number | null = null;
  let pollingActive = false;
  const processedSignatures = new Set<string>(); // Track processed signatures to avoid duplicates
  const subscriptionStartTime = Date.now(); // Track when subscription started to only show new transactions

  // Determine if we should use polling
  // Default to polling since most free/public RPC providers don't support
  // WebSocket subscriptions (they return "Method 'logsSubscribe' not found" error)
  // Set usePollingMode: false to try WebSocket if your RPC provider supports it
  const usePolling = usePollingMode;

  // Start polling function
  const startPolling = async () => {
    if (pollingActive) return;
    pollingActive = true;

    let pollCount = 0;
    const statusInterval = 2500; // Show status every 2.5 seconds
    let lastStatusTime = Date.now();

    // Initial poll immediately (but only process transactions after start time)
    await pollForTradeEvents(
      connection,
      callback,
      mint,
      eventParser,
      processedSignatures,
      subscriptionStartTime,
      pollInterval
    );

    // Then poll at intervals
    while (!isUnsubscribed) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      if (!isUnsubscribed) {
        pollCount++;
        await pollForTradeEvents(
          connection,
          callback,
          mint,
          eventParser,
          processedSignatures,
          subscriptionStartTime,
          pollInterval
        );

        // Show status periodically
        const now = Date.now();
        if (now - lastStatusTime >= statusInterval) {
          console.log(`   [Status] Polling active... (${pollCount} polls, ${processedSignatures.size} transactions processed)`);
          lastStatusTime = now;
        }
      }
    }
  };

  if (usePolling) {
    // Use polling mode (works with all RPC providers)
    console.log('📡 Using polling mode (compatible with all RPC providers)');
    console.log(`   Polling every ${pollInterval}ms`);
    if (mint) {
      const [bondingCurve] = deriveBondingCurvePDA(mint);
      console.log(`   Monitoring token: ${mint.toBase58()}`);
      console.log(`   Bonding curve: ${bondingCurve.toBase58()}\n`);
    } else {
      console.log(`   Monitoring all Pump Fun trades`);
      console.log(`   Program: ${PUMP_FUN_PROGRAM.toBase58()}\n`);
    }
    startPolling();

    return {
      unsubscribe: () => {
        isUnsubscribed = true;
        pollingActive = false;
      },
    };
  }

  // Try WebSocket subscription (only if we think it's supported)
  try {
    // If mint is provided, subscribe to the bonding curve account for that specific token
    // Otherwise, subscribe to all program logs
    const subscribeAddress = mint 
      ? deriveBondingCurvePDA(mint)[0]  // Use bonding curve PDA for specific token
      : PUMP_FUN_PROGRAM;                // Use program for all tokens

    subscriptionId = connection.onLogs(
      subscribeAddress,
      (logs, context) => {
        if (isUnsubscribed) return;

        // Only process logs that came after subscription started
        // Context has slot info, but we'll rely on the fact that onLogs only
        // sends new logs, so we can process all of them
        try {
          // Parse events from the logs using Anchor's event parser
          const events = eventParser.parseLogs(logs.logs);

          for (const event of events) {
            // Check if this is a TradeEvent
            // Anchor events have the structure: { name: 'TradeEvent', data: {...} }
            if (event.name === 'TradeEvent') {
              const tradeEvent = parseTradeEvent(event.data);

              if (tradeEvent) {
                // If we subscribed to a specific bonding curve, the mint should already match
                // But double-check to be safe
                if (mint && !tradeEvent.mint.equals(mint)) {
                  continue;
                }

                // Call the callback with the parsed event
                callback(tradeEvent, logs.signature);
              }
            }
          }
        } catch (error) {
          // Silently handle parsing errors (some logs might not be events)
          // Only log if it's a real issue
          if (error instanceof Error && !error.message.includes('Failed to decode')) {
            console.error('Error processing logs:', error);
          }
        }
      },
      'confirmed' // Use confirmed commitment for faster updates
    );

    if (mint) {
      const [bondingCurve] = deriveBondingCurvePDA(mint);
      console.log('✅ Using WebSocket subscription (real-time updates)');
      console.log(`   Monitoring token: ${mint.toBase58()}`);
      console.log(`   Bonding curve: ${bondingCurve.toBase58()}\n`);
    } else {
      console.log('✅ Using WebSocket subscription (real-time updates)');
      console.log(`   Monitoring all Pump Fun trades\n`);
    }

    return {
      unsubscribe: () => {
        isUnsubscribed = true;
        if (subscriptionId !== null) {
          try {
            connection.removeOnLogsListener(subscriptionId);
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
        if (subscriptionId !== null) {
          try {
            connection.removeOnLogsListener(subscriptionId);
          } catch (error) {
            // Ignore errors when unsubscribing
          }
        }
      },
    };
  }
}

/**
 * Helper function to format trade event for display
 */
export function formatTradeEvent(event: TradeEvent): string {
  const tradeType = event.isBuy ? 'BUY' : 'SELL';
  const solAmount = Number(event.solAmount) / 1e9; // Convert lamports to SOL
  const tokenAmount = Number(event.tokenAmount) / 1e6; // Assuming 6 decimals, adjust if needed
  
  return `[${tradeType}] ${event.ixName} | Mint: ${event.mint.toBase58().slice(0, 8)}... | ` +
         `SOL: ${solAmount.toFixed(4)} | Tokens: ${tokenAmount.toLocaleString()} | ` +
         `User: ${event.user.toBase58().slice(0, 8)}...`;
}

