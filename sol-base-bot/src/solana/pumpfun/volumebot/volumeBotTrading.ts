import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { createPumpFunProgram } from '../anchor.js';
import { buildBuyInstruction, buildSellInstruction } from '../instructions.js';
import { createTransaction, sendAndConfirmTransactionWithPolling } from '../transactions.js';
import { getCoinData } from '../api.js';
import { TradeRecord } from './volumeBotTypes.js';

/**
 * Get a random trade size within the specified range
 */
export function getRandomTradeSize(min: number, max: number, randomize: boolean): number {
    if (!randomize) {
        return min;
    }
    return min + Math.random() * (max - min);
}

/**
 * Determine if next trade should be a buy based on probability
 */
export function shouldBuy(buyProbability: number): boolean {
    return Math.random() * 100 < buyProbability;
}

/**
 * Execute a buy trade on Pump.fun
 * Calculates expected tokens from bonding curve for given SOL amount
 */
export async function executeBuyTrade(
    connection: Connection,
    wallet: Keypair,
    tokenMint: PublicKey,
    solAmount: number,
    solPriceUsd: number,
    priorityFeeSol: number,
    slippagePercent: number
): Promise<TradeRecord> {
    const timestamp = new Date();
    const direction = 'BUY';

    try {
        console.log(`\n🟢 Executing BUY: ${solAmount.toFixed(6)} SOL`);

        const mintStr = tokenMint.toBase58();

        // Get coin data to estimate token output
        const coinData = await getCoinData(mintStr);
        if (!coinData) {
            throw new Error('Failed to fetch coin data');
        }

        // Calculate approximate tokens for this SOL amount
        const vSol = BigInt(coinData['virtual_sol_reserves']);
        const vToken = BigInt(coinData['virtual_token_reserves']);
        const solInLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL * 0.99));

        // Estimate token output
        const estimatedTokenOut = (solInLamports * vToken) / (vSol + solInLamports);
        const tokenAmount = Number(estimatedTokenOut) / 1e6;

        console.log(`   💡 Estimated tokens: ${tokenAmount.toFixed(2)}`);
        console.log(`   💵 Max SOL cost: ${solAmount.toFixed(6)} SOL + ${slippagePercent}% slippage`);
        console.log(`   💰 USD value: ~$${(solAmount * solPriceUsd).toFixed(4)}`);

        // Apply slippage to the ORIGINAL solAmount
        const maxSolCostWithSlippage = solAmount * (1 + slippagePercent / 100);
        const maxSolCost = BigInt(Math.floor(maxSolCostWithSlippage * LAMPORTS_PER_SOL));
        const tokenOut = BigInt(Math.floor(tokenAmount * 1e6));

        // Build and execute transaction
        const program = await createPumpFunProgram(connection);
        const buyIx = await buildBuyInstruction(
            program,
            connection,
            tokenMint,
            wallet.publicKey,
            tokenOut,
            maxSolCost,
            true
        );

        const transaction = await createTransaction(
            connection,
            [buyIx],
            wallet.publicKey,
            priorityFeeSol
        );

        const signature = await sendAndConfirmTransactionWithPolling(
            connection,
            transaction,
            [wallet],
            { commitment: 'confirmed' }
        );

        const gasUsedSol = priorityFeeSol + (5000 / LAMPORTS_PER_SOL);

        console.log(`   ✅ BUY Success! Signature: ${signature}`);
        console.log(`   📊 Tokens received: ~${tokenAmount.toFixed(2)}`);

        return {
            timestamp,
            direction,
            tokenAmount,
            solAmount,
            usdValue: solAmount * solPriceUsd,
            gasUsedSol,
            signature,
            success: true,
        };
    } catch (error) {
        console.error(`   ❌ BUY Failed:`, error instanceof Error ? error.message : String(error));

        return {
            timestamp,
            direction,
            tokenAmount: 0,
            solAmount,
            usdValue: solAmount * solPriceUsd,
            gasUsedSol: priorityFeeSol,
            signature: '',
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Execute a sell trade on Pump.fun
 * Calculates expected SOL from bonding curve for given token amount
 */
export async function executeSellTrade(
    connection: Connection,
    wallet: Keypair,
    tokenMint: PublicKey,
    tokenAmount: number,
    solPriceUsd: number,
    priorityFeeSol: number,
    slippagePercent: number
): Promise<TradeRecord> {
    const timestamp = new Date();
    const direction = 'SELL';

    try {
        console.log(`\n🔴 Executing SELL: ${tokenAmount.toFixed(2)} tokens`);

        const mintStr = tokenMint.toBase58();

        // Get coin data for bonding curve calculation
        const coinData = await getCoinData(mintStr);
        if (!coinData) {
            throw new Error('Failed to fetch coin data');
        }

        // Calculate expected SOL output from bonding curve
        const vSol = BigInt(coinData['virtual_sol_reserves']);
        const vToken = BigInt(coinData['virtual_token_reserves']);
        const tokenIn = BigInt(Math.floor(tokenAmount * 1e6));

        // Calculate SOL output: solOut = vSol - (k / (vToken + tokenIn))
        // Where k = vSol * vToken
        const k = vSol * vToken;
        const newVToken = vToken + tokenIn;
        const newVSol = k / newVToken;
        const solOutBeforeFee = vSol - newVSol;

        // Apply 1% fee
        const solOut = (solOutBeforeFee * BigInt(99)) / BigInt(100);
        const expectedSol = Number(solOut) / LAMPORTS_PER_SOL;

        console.log(`   💡 Expected SOL: ${expectedSol.toFixed(6)} SOL`);
        console.log(`   💰 USD value: ~$${(expectedSol * solPriceUsd).toFixed(4)}`);

        // Apply slippage to minimum output
        const minSolOutput = (solOut * BigInt(100 - Math.floor(slippagePercent))) / BigInt(100);

        // Build and execute transaction
        const program = await createPumpFunProgram(connection);
        const sellIx = await buildSellInstruction(
            program,
            connection,
            tokenMint,
            wallet.publicKey,
            tokenIn,
            minSolOutput
        );

        const transaction = await createTransaction(
            connection,
            [sellIx],
            wallet.publicKey,
            priorityFeeSol
        );

        const signature = await sendAndConfirmTransactionWithPolling(
            connection,
            transaction,
            [wallet],
            { commitment: 'confirmed' }
        );

        const gasUsedSol = priorityFeeSol + (5000 / LAMPORTS_PER_SOL);

        console.log(`   ✅ SELL Success! Signature: ${signature}`);
        console.log(`   💰 SOL received: ${expectedSol.toFixed(6)}`);

        return {
            timestamp,
            direction,
            tokenAmount,
            solAmount: expectedSol,
            usdValue: expectedSol * solPriceUsd,
            gasUsedSol,
            signature,
            success: true,
        };
    } catch (error) {
        console.error(`   ❌ SELL Failed:`, error instanceof Error ? error.message : String(error));

        return {
            timestamp,
            direction,
            tokenAmount,
            solAmount: 0,
            usdValue: 0,
            gasUsedSol: priorityFeeSol,
            signature: '',
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
