import { loadConfig } from '../../config.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPumpFunProgram } from '../pumpfun/anchor.js';
import { buildBuyInstruction } from '../pumpfun/instructions.js';
import { createConnection } from '../utils.js';
import { createTransaction, simulateTransaction } from '../pumpfun/transactions.js';
import {
  getTokenMint,
  setupPayer,
  getTokenBalance,
  logTokenBalance,
  displaySimulationResults,
  getInitialBalances,
  logInitialBalances,
  sendTransaction,
  getFinalBalances,
  displayBuyBalanceChanges,
  printHeader,
  printFooter,
  logError,
  handleTestError,
} from '../../utils/testHelpers.js';
import { createReadlineInterface, promptConfirmation } from '../../utils/cliUtils.js';

async function testTokenBuy() {
  const config = loadConfig();
  const rl = createReadlineInterface();

  printHeader('🚀 ARBITRAGE BOT - TOKEN BUY SIMULATION TEST');

  // Get token address
  const solanaMint = getTokenMint(config.SOLANA_TOKEN_MINT);
  console.log(`   Token Address: ${solanaMint}`);

  // Setup connection and payer
  const connection = createConnection(config.SOLANA_RPC_HTTP_URL);
  const payer = await setupPayer(config.SOLANA_PRIVATE_KEY, connection);

  // Check token balance if using real keypair
  if (config.SOLANA_PRIVATE_KEY) {
    const mint = new PublicKey(solanaMint);
    const tokenBalance = await getTokenBalance(connection, mint, payer.publicKey);
    logTokenBalance(tokenBalance, 'Token Balance');
    console.log('');
  }

  // Test parameters
  const tokenAmount = 1000000; // Amount of tokens to buy
  const maxSolCost = 0.1; // Maximum SOL willing to spend (slippage protection)
  const trackVolume = false;

  console.log('📊 Buy Parameters:');
  console.log(`   Token Amount: ${tokenAmount.toLocaleString()} tokens`);
  console.log(`   Max SOL Cost: ${maxSolCost} SOL`);
  console.log(`   Track Volume: ${trackVolume}\n`);

  try {
    // Create program instance
    console.log('🔧 Creating PumpFun program instance...');
    const program = createPumpFunProgram(connection, payer);

    // Convert to proper types
    const mint = new PublicKey(solanaMint);
    const tokenOut = BigInt(Math.floor(tokenAmount));
    const maxSolCostLamports = BigInt(Math.floor(maxSolCost * LAMPORTS_PER_SOL));

    // Build instruction
    console.log('📝 Building buy instruction...');
    const instruction = await buildBuyInstruction(
      program,
      connection,
      mint,
      payer.publicKey,
      tokenOut,
      maxSolCostLamports,
      trackVolume
    );

    // Create and sign transaction
    console.log('📦 Creating transaction...');
    const transaction = await createTransaction(
      connection,
      [instruction],
      payer.publicKey,
      config.SOLANA_PRIORITY_FEE_SOL
    );
    transaction.sign(payer);

    // Simulate transaction
    console.log('🔍 Simulating transaction...');
    const simulation = await simulateTransaction(connection, transaction, payer);

    // Display simulation results
    displaySimulationResults(simulation, transaction, payer, config);

    // Send actual transaction (if private key is provided)
    if (config.SOLANA_PRIVATE_KEY && !simulation.value.err) {
      // Prompt for confirmation
      console.log('⚠️  Ready to execute transaction!');
      const confirmed = await promptConfirmation(
        rl,
        '   Do you want to proceed? (yes/no): '
      );

      if (!confirmed) {
        console.log('\n❌ Transaction cancelled by user\n');
        rl.close();
        process.exit(0);
      }

      printHeader('📤 SENDING ACTUAL TRANSACTION');

      try {
        // Get initial balances
        const { solBalance: initialSOLBalance, tokenBalance: initialTokenBalance } =
          await getInitialBalances(connection, payer.publicKey, mint);
        logInitialBalances(initialSOLBalance, initialTokenBalance);

        // Send transaction
        const signature = await sendTransaction(connection, transaction, payer);

        // Get transaction details
        console.log('\n🔍 Fetching transaction details...');
        const txDetails = await connection.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!txDetails) {
          console.warn('⚠️  Could not fetch transaction details');
        } else {
          // Get final balances
          const { solBalance: finalSOLBalance } = await getFinalBalances(
            connection,
            payer.publicKey,
            mint
          );
          displayBuyBalanceChanges(initialSOLBalance, finalSOLBalance);
        }

        printFooter('✅ Transaction Sent and Confirmed');

      } catch (error) {
        logError(error, 'Error sending transaction');
        rl.close();
        throw error;
      }
    } else {
      printFooter('✅ Token Buy Simulation Test Completed', !config.SOLANA_PRIVATE_KEY);
    }

  } catch (error) {
    logError(error, 'Error during simulation');
    rl.close();
    throw error;
  }

  rl.close();
  process.exit(0);
}

testTokenBuy().catch(handleTestError);

