import { loadConfig } from '../../config.js';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createPumpFunProgram } from '../pumpfun/anchor.js';
import { buildSellInstruction } from '../pumpfun/instructions.js';
import { createConnection } from '../utils.js';
import { createTransaction, simulateTransaction } from '../pumpfun/transactions.js';
import {
  getTokenMint,
  setupPayer,
  displaySimulationError,
  displayTransactionFee,
  getInitialBalances,
  logInitialBalances,
  sendTransaction,
  getFinalBalances,
  displaySellBalanceChanges,
  printHeader,
  printFooter,
  logError,
  handleTestError,
} from '../../utils/testHelpers.js';
import { createReadlineInterface, promptConfirmation } from '../../utils/cliUtils.js';

async function testTokenSell() {
  const config = loadConfig();
  const rl = createReadlineInterface();

  printHeader('🚀 ARBITRAGE BOT - TOKEN SELL SIMULATION TEST');

  // Get token address
  const solanaMint = getTokenMint(config.SOLANA_TOKEN_MINT);
  console.log('📋 Configuration:');
  console.log(`   Token Address: ${solanaMint}`);

  // Setup connection and payer
  const connection = createConnection(config.SOLANA_RPC_HTTP_URL);
  const payer = await setupPayer(config.SOLANA_PRIVATE_KEY, connection);

  // Test parameters
  const tokenAmount = 1000000; // Amount of tokens to sell
  const minSolOutput = 0.000000001; // Minimum SOL to receive (slippage protection)

  console.log('📊 Sell Parameters:');
  console.log(`   Token Amount: ${tokenAmount.toLocaleString()} tokens`);
  console.log(`   Min SOL Output: ${minSolOutput} SOL\n`);

  try {
    // Create program instance
    const program = createPumpFunProgram(connection, payer);

    // Convert to proper types
    const mint = new PublicKey(solanaMint);
    const tokenIn = BigInt(Math.floor(tokenAmount));
    const minSolOutputLamports = BigInt(Math.floor(minSolOutput * LAMPORTS_PER_SOL));

    // Build instruction
    const instruction = await buildSellInstruction(
      program,
      connection,
      mint,
      payer.publicKey,
      tokenIn,
      minSolOutputLamports
    );

    // Create and sign transaction
    const transaction = await createTransaction(
      connection,
      [instruction],
      payer.publicKey,
      config.SOLANA_PRIORITY_FEE_SOL
    );
    transaction.sign(payer);

    // Simulate transaction
    console.log('🔍 Simulating transaction...\n');
    const simulation = await simulateTransaction(connection, transaction, payer);

    // Display simulation results
    console.log('='.repeat(70));
    console.log('📊 SIMULATION RESULTS');
    console.log('='.repeat(70) + '\n');

    if (!displaySimulationError(simulation)) {
      displayTransactionFee(simulation, config);
    }

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
        const txDetails = await connection.getParsedTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!txDetails) {
          console.warn('⚠️  Could not fetch transaction details');
        } else {
          // Get final balances
          const { solBalance: finalSOLBalance, tokenBalance: finalTokenBalance } =
            await getFinalBalances(connection, payer.publicKey, mint);
          displaySellBalanceChanges(
            initialSOLBalance,
            finalSOLBalance,
            initialTokenBalance,
            finalTokenBalance,
          );
        }

        printFooter('✅ Transaction Sent and Confirmed');

      } catch (error) {
        logError(error, 'Error sending transaction');
        rl.close();
        throw error;
      }
    } else {
      printFooter('✅ Token Sell Simulation Test Completed', !config.SOLANA_PRIVATE_KEY);
    }

  } catch (error) {
    logError(error, 'Error during simulation');
    rl.close();
    throw error;
  }

  rl.close();
  process.exit(0);
}

testTokenSell().catch(handleTestError);

