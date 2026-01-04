import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import { AppConfig } from '../config.js';
import { getKeyPairFromPrivateKey  } from '../solana/utils.js';
import { sendAndConfirmTransactionWithPolling } from '../solana/pumpfun/transactions.js';

// ============================================================================
// SETUP HELPERS
// ============================================================================

export type TokenAmount = {
    amount: string,
    decimals: number,
    uiAmount: number,
    uiAmountString: string
}

/**
 * Gets the token mint address from config
 */
export function getTokenMint(token_mint_address:string|undefined): string {
  const solanaMint = token_mint_address || token_mint_address?.split(',')[0]?.trim();
  if (!solanaMint) {
    throw new Error('Missing SOLANA_TOKEN_MINT or SOLANA_TOKEN_MINTS');
  }
  return solanaMint;
}


/**
 * Sets up the payer keypair (real or dummy for simulation)
 */
export async function setupPayer(
  private_key: string,
  connection: Connection
): Promise<Keypair> {
  let payer: Keypair;
  
  if (private_key) {
    payer = getKeyPairFromPrivateKey(private_key);
    console.log(`   Payer Address: ${payer.publicKey.toBase58()}`);
    
    const balance = await connection.getBalance(payer.publicKey);
    console.log(`   Payer Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
    console.log('');
  } else {
    payer = Keypair.generate();
    console.log(`   Using dummy keypair for simulation: ${payer.publicKey.toBase58()}\n`);
  }
  
  return payer;
}

/**
 * Gets token balance for a given mint and owner
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<TokenAmount> {
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    console.log("TOKEN ACCOUNTS: ", tokenAccounts.value[0].account.data.parsed.info);
    if (tokenAccounts.value.length > 0) {
      return tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
    }
    return { amount: '0', decimals: 0, uiAmount: 0, uiAmountString: '0' };
  } catch (e) {
    return { amount: '0', decimals: 0, uiAmount: 0, uiAmountString: '0' };
  }
}

/**
 * Logs token balance in a readable format
 */
export function logTokenBalance(
  balance: TokenAmount,
  label: string = 'Token Balance',
): void {
  if (Number(balance.uiAmount) === 0) {
    console.log(`   ${label}: 0 tokens (no token account found)`);
  } else {
    console.log(`   ${label}: ${balance.uiAmountString} tokens`);
  }
}

// ============================================================================
// TRANSACTION SIMULATION HELPERS
// ============================================================================

/**
 * Simulates a transaction with fallback support
 */
// export async function simulateTransaction(
//   connection: Connection,
//   transaction: Transaction,
//   payer: Keypair
// ) {
//   try {
//     // Try using VersionedTransaction with config (preferred method)
//     const message = transaction.compileMessage();
//     const versionedTx = new VersionedTransaction(message);
    
//     const simulateConfig: SimulateTransactionConfig = {
//       commitment: 'confirmed',
//       replaceRecentBlockhash: true,
//       sigVerify: false,
//       accounts: {
//         encoding: 'base64',
//         addresses: [payer.publicKey.toBase58()],
//       },
//     };

//     return await connection.simulateTransaction(versionedTx, simulateConfig);
//   } catch (e) {
//     // Fallback to legacy API
//     console.warn('   ⚠️  VersionedTransaction simulation failed, using legacy API');
//     return await connection.simulateTransaction(transaction, [payer], [payer.publicKey]);
//   }
// }

/**
 * Displays simulation error if present
 */
export function displaySimulationError(simulation: any): boolean {
  if (simulation.value.err) {
    console.error('❌ Simulation Error:');
    console.error(JSON.stringify(simulation.value.err, null, 2));
    console.log('\n');
    return true;
  }
  return false;
}

/**
 * Displays simulation results (includes cost breakdown for buy transactions)
 */
export function displaySimulationResults(
  simulation: any,
  transaction: Transaction,
  payer: Keypair,
  config: AppConfig
): void {
  console.log('='.repeat(70));
  console.log('📊 SIMULATION RESULTS');
  console.log('='.repeat(70) + '\n');

  if (displaySimulationError(simulation)) {
    return;
  }

  console.log('✅ Simulation Successful!\n');

  // Display transaction cost for buy transactions
  const preBalances = (simulation.value as any).preBalances as number[] | undefined;
  const postBalances = (simulation.value as any).postBalances as number[] | undefined;
  
  if (preBalances && postBalances) {
    const message = transaction.compileMessage();
    const accountKeys = message.accountKeys;
    const payerAddress = payer.publicKey.toBase58();
    
    for (let i = 0; i < Math.max(preBalances.length, postBalances.length); i++) {
      const accountAddress = accountKeys && accountKeys[i] ? accountKeys[i].toBase58() : '';
      if (accountAddress === payerAddress) {
        const preBalanceSOL = preBalances[i] / LAMPORTS_PER_SOL;
        const postBalanceSOL = postBalances[i] / LAMPORTS_PER_SOL;
        const transactionCostSOL = preBalanceSOL - postBalanceSOL;
        
        console.log('\n💸 Transaction Cost (Sender):');
        console.log(`   Payer Account Index: ${i}`);
        console.log(`   Pre-Transaction Balance: ${preBalanceSOL.toFixed(9)} SOL`);
        console.log(`   Post-Transaction Balance: ${postBalanceSOL.toFixed(9)} SOL`);
        console.log(`   Total Cost: ${transactionCostSOL.toFixed(9)} SOL`);
        
        if (config.SOLANA_SOL_PRICE_USD) {
          const costUSD = transactionCostSOL * config.SOLANA_SOL_PRICE_USD;
          console.log(`   Cost (USD): $${costUSD.toFixed(2)}`);
        }
        break;
      }
    }
  }

  // Display transaction fee
  displayTransactionFee(simulation, config);
}

/**
 * Displays transaction fee information
 */
export function displayTransactionFee(simulation: any, config: AppConfig): void {
  const fee = (simulation.value as any).fee as number | undefined;
  if (fee === undefined) return;

  console.log('\n💳 Transaction Fee:');
  const feeSOL = fee / LAMPORTS_PER_SOL;
  console.log(`   Fee (Lamports): ${fee.toLocaleString()}`);
  console.log(`   Fee (SOL): ${feeSOL.toFixed(9)} SOL`);
  
  if (config.SOLANA_SOL_PRICE_USD) {
    const feeUSD = feeSOL * config.SOLANA_SOL_PRICE_USD;
    console.log(`   Fee (USD): $${feeUSD.toFixed(4)}`);
  }
}

// ============================================================================
// TRANSACTION EXECUTION HELPERS
// ============================================================================

/**
 * Gets initial balances before transaction
 */
export async function getInitialBalances(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
): Promise<{ solBalance: number; tokenBalance: TokenAmount }> {
  const solBalance = await connection.getBalance(payer);
  const tokenBalance = await getTokenBalance(connection, mint, payer);
  
  return {
    solBalance,
    tokenBalance,
  };
}

/**
 * Logs initial balances
 */
export function logInitialBalances(
  solBalance: number,
  tokenBalance: TokenAmount
): void {
  console.log(`💰 Initial SOL Balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  logTokenBalance(tokenBalance, '🪙 Initial Token Balance');
}

/**
 * Sends and confirms a transaction
 */
export async function sendTransaction(
  connection: Connection,
  transaction: Transaction,
  payer: Keypair
): Promise<string> {
  console.log('\n📡 Sending transaction...');
  
  const signature = await sendAndConfirmTransactionWithPolling(
    connection,
    transaction,
    [payer],
    {
      commitment: 'confirmed',
      skipPreflight: false,
    }
  );

  console.log(`✅ Transaction confirmed!`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Explorer: https://solscan.io/tx/${signature}`);

  // Wait for transaction to be fully processed
  await new Promise(resolve => setTimeout(resolve, 10000));

  return signature;
}

/**
 * Gets final balances after transaction
 */
export async function getFinalBalances(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
): Promise<{ solBalance: number; tokenBalance: TokenAmount }> {
  const solBalance = await connection.getBalance(payer);
  const tokenBalance = await getTokenBalance(connection, mint, payer);
  
  return {
    solBalance,
    tokenBalance,
  };
}

/**
 * Displays final balance changes for buy transaction
 */
export function displayBuyBalanceChanges(
  initialSOL: number,
  finalSOL: number,
): void {
  const solWithdrawn = (initialSOL - finalSOL) / LAMPORTS_PER_SOL;
  
  console.log('\n💰 Final Balance Changes:');
  console.log(`   Final SOL Balance: ${(finalSOL / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  console.log(`   SOL Withdrawn: ${solWithdrawn.toFixed(9)} SOL`);
}

/**
 * Displays final balance changes for sell transaction
 */
export function displaySellBalanceChanges(
  initialSOL: number,
  finalSOL: number,
  initialToken: TokenAmount,
  finalToken: TokenAmount,
): void {
  const solReceived = (finalSOL - initialSOL) / LAMPORTS_PER_SOL;
  const tokensSold = Number(initialToken.uiAmount) - Number(finalToken.uiAmount);
  
  console.log('\n💰 Final Balance Changes:');
  console.log(`   Final SOL Balance: ${(finalSOL / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  console.log(`   SOL Received: ${solReceived.toFixed(9)} SOL`);
  console.log(`   Final Token Balance: ${finalToken.uiAmountString} tokens`);
  console.log(`   Tokens Sold: ${tokensSold.toLocaleString()} tokens`);
  

}

// ============================================================================
// DISPLAY HELPERS
// ============================================================================

/**
 * Prints a section header
 */
export function printHeader(title: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70) + '\n');
}

/**
 * Prints a section footer
 */
export function printFooter(title: string, isSimulationOnly: boolean = false): void {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  if (isSimulationOnly) {
    console.log('   (No private key provided - simulation only)');
  }
  console.log('='.repeat(70) + '\n');
}

// ============================================================================
// ERROR HANDLING HELPERS
// ============================================================================

/**
 * Logs an error in a consistent format
 */
export function logError(error: unknown, context: string): void {
  console.error(`\n❌ ${context}:`);
  if (error instanceof Error) {
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  } else {
    console.error(error);
  }
}

/**
 * Handles test execution errors
 */
export function handleTestError(error: unknown): void {
  logError(error, 'Test failed');
  process.exit(1);
}

