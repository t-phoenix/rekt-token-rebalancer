import {Connection, Transaction, Keypair, VersionedTransaction, SimulateTransactionConfig, TransactionInstruction, ComputeBudgetProgram, PublicKey} from '@solana/web3.js';

export async function simulateTransaction(
    connection: Connection,
    transaction: Transaction,
    payer: Keypair
  ) {
    try {
      // Try using VersionedTransaction with config (preferred method)
      const message = transaction.compileMessage();
      const versionedTx = new VersionedTransaction(message);
      
      const simulateConfig: SimulateTransactionConfig = {
        commitment: 'confirmed',
        replaceRecentBlockhash: true,
        sigVerify: false,
        accounts: {
          encoding: 'base64',
          addresses: [payer.publicKey.toBase58()],
        },
      };
  
      return await connection.simulateTransaction(versionedTx, simulateConfig);
    } catch (e) {
      // Fallback to legacy API
      console.warn('   ⚠️  VersionedTransaction simulation failed, using legacy API');
      return await connection.simulateTransaction(transaction, [payer], [payer.publicKey]);
    }
  }


  export async function createTransaction(
    connection: Connection,
    instructions: TransactionInstruction[],
    payer: PublicKey,
    priorityFeeInSol: number = 0
  ): Promise<Transaction> {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000,
    });
  
    const transaction = new Transaction().add(modifyComputeUnits);
  
    if (priorityFeeInSol > 0) {
      const microLamports = Math.floor(priorityFeeInSol * 1_000_000_000);
      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports,
      });
      transaction.add(addPriorityFee);
    }
  
    transaction.add(...instructions);
    transaction.feePayer = payer;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    return transaction;
  }
  
  /**
   * Sends a transaction and confirms it using polling instead of WebSocket subscriptions.
   * This works with RPC providers that don't support signatureSubscribe.
   */
  export async function sendAndConfirmTransactionWithPolling(
    connection: Connection,
    transaction: Transaction,
    signers: Keypair[],
    options: {
      commitment?: 'processed' | 'confirmed' | 'finalized';
      skipPreflight?: boolean;
      maxRetries?: number;
    } = {}
  ): Promise<string> {
    const {
      commitment = 'confirmed',
      skipPreflight = false,
    } = options;
  
    // Send the transaction
    const signature = await connection.sendTransaction(transaction, signers, {
      skipPreflight,
    });
  
    // Poll for confirmation manually (works with RPC providers that don't support WebSocket subscriptions)
    const maxRetries = options.maxRetries || 30;
    const pollInterval = 1000; // 1 second
    
    for (let i = 0; i < maxRetries; i++) {
      const status = await connection.getSignatureStatus(signature);
      
      if (status?.value) {
        if (status.value.err) {
          const error = new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
          (error as any).signature = signature;
          throw error;
        }
        
        // Check if the transaction has reached the desired commitment level
        const confirmationStatus = status.value.confirmationStatus;
        if (confirmationStatus === commitment || 
            (commitment === 'confirmed' && confirmationStatus === 'finalized') ||
            (commitment === 'processed' && (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized'))) {
          return signature;
        }
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    // If we've exhausted retries, check one more time
    const finalStatus = await connection.getSignatureStatus(signature);
    
    if (finalStatus?.value?.err) {
      const error = new Error(`Transaction failed: ${JSON.stringify(finalStatus.value.err)}`);
      (error as any).signature = signature;
      throw error;
    }
    
    if (!finalStatus?.value) {
      throw new Error(`Transaction ${signature} not found after ${maxRetries} attempts`);
    }
    
    return signature;
  }