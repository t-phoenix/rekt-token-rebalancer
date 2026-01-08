import { createReadlineInterface } from './cliUtils.js';
import { VolumeConfig, HARDCODED_DEFAULTS } from '../solana/pumpfun/volumebot/volumeBotTypes.js';

/**
 * Prompt user for a single configuration value
 */
async function askQuestion(rl: any, question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer: string) => {
            resolve(answer.trim());
        });
    });
}

/**
 * Get volume bot configuration from user via interactive prompts
 * Reads credentials from .env and asks only for essential trading parameters
 */
export async function getUserConfig(): Promise<VolumeConfig> {
    const rl = createReadlineInterface();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     SOLANA VOLUME BOT - PUMP.FUN CONFIGURATION            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
        // Read from .env file
        const rpcUrl = process.env.SOLANA_RPC_HTTP_URL;
        const privateKey = process.env.SOLANA_PRIVATE_KEY;
        const tokenMint = process.env.SOLANA_TOKEN_MINT;

        // Validate required .env variables
        if (!rpcUrl) {
            throw new Error('SOLANA_RPC_HTTP_URL not found in .env file');
        }
        if (!privateKey) {
            throw new Error('SOLANA_PRIVATE_KEY not found in .env file');
        }
        if (!tokenMint) {
            throw new Error('SOLANA_TOKEN_MINT not found in .env file');
        }

        console.log('✅ Loaded configuration from .env file');
        console.log(`   RPC: ${rpcUrl.slice(0, 40)}...`);
        console.log(`   Token: ${tokenMint.slice(0, 20)}...`);
        console.log('');

        // Only ask for essential trading parameters
        console.log('📝 Please configure trading parameters:\n');

        // Min Trade Amount
        const minTradeInput = await askQuestion(
            rl,
            '💰 Minimum trade amount in SOL (e.g., 0.01): '
        );
        const minTradeAmountSol = parseFloat(minTradeInput) || 0.01;

        // Max Trade Amount
        const maxTradeInput = await askQuestion(
            rl,
            '💰 Maximum trade amount in SOL (e.g., 0.1): '
        );
        const maxTradeAmountSol = parseFloat(maxTradeInput) || 0.1;

        // Trading Interval
        const intervalInput = await askQuestion(
            rl,
            '⏱️  Trading interval in seconds (e.g., 30): '
        );
        const tradingIntervalMs = (parseFloat(intervalInput) || 30) * 1000;

        // Slippage
        const slippageInput = await askQuestion(
            rl,
            '📊 Slippage tolerance % (e.g., 5): '
        );
        const slippagePercent = parseFloat(slippageInput) || 5;

        rl.close();

        console.log('\n✅ Configuration complete!\n');

        return {
            rpcUrl,
            privateKey,
            tokenMint,
            minTradeAmountSol,
            maxTradeAmountSol,
            tradingIntervalMs,
            slippagePercent,
            // Hardcoded values
            summaryIntervalMs: HARDCODED_DEFAULTS.SUMMARY_INTERVAL_SECONDS * 1000,
            priorityFeeSol: HARDCODED_DEFAULTS.PRIORITY_FEE_SOL,
            buyProbability: HARDCODED_DEFAULTS.BUY_PROBABILITY,
            randomizeTradeSize: HARDCODED_DEFAULTS.RANDOMIZE_TRADE_SIZE,
            maxTotalVolumeUsd: HARDCODED_DEFAULTS.MAX_TOTAL_VOLUME_USD,
            runDurationMinutes: HARDCODED_DEFAULTS.RUN_DURATION_MINUTES,
        };
    } catch (error) {
        rl.close();
        throw error;
    }
}
