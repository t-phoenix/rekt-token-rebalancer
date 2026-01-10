import { createReadlineInterface } from './cliUtils.js';
import { VolumeConfig, HARDCODED_DEFAULTS } from '../base/volumebot/volumeBotTypes.js';

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
    console.log('║     BASE VOLUME BOT - UNISWAP V2 CONFIGURATION            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    try {
        // Read from .env file
        const rpcUrl = process.env.BASE_RPC_HTTP_URL;
        const privateKey = process.env.BASE_PRIVATE_KEY_HEX;
        const tokenAddress = process.env.BASE_TOKEN_ADDRESS;
        const usdcAddress = process.env.BASE_USDC_ADDRESS;
        const routerAddress = process.env.UNISWAP_V2_ROUTER02_ADDRESS;

        // Validate required .env variables
        if (!rpcUrl) {
            throw new Error('BASE_RPC_HTTP_URL not found in .env file');
        }
        if (!privateKey) {
            throw new Error('BASE_PRIVATE_KEY_HEX not found in .env file');
        }
        if (!tokenAddress) {
            throw new Error('BASE_TOKEN_ADDRESS not found in .env file');
        }
        if (!usdcAddress) {
            throw new Error('BASE_USDC_ADDRESS not found in .env file');
        }
        if (!routerAddress) {
            throw new Error('UNISWAP_V2_ROUTER02_ADDRESS not found in .env file');
        }

        console.log('✅ Loaded configuration from .env file');
        console.log(`   RPC: ${rpcUrl.slice(0, 40)}...`);
        console.log(`   Token: ${tokenAddress.slice(0, 20)}...`);
        console.log(`   USDC: ${usdcAddress.slice(0, 20)}...`);
        console.log(`   Router: ${routerAddress.slice(0, 20)}...`);
        console.log('');

        // Only ask for essential trading parameters
        console.log('📝 Please configure trading parameters:\n');

        // Min Trade Amount
        const minTradeInput = await askQuestion(
            rl,
            '💰 Minimum trade amount in USDC (e.g., 5): '
        );
        const minTradeAmountUsdc = parseFloat(minTradeInput) || 5;

        // Max Trade Amount
        const maxTradeInput = await askQuestion(
            rl,
            '💰 Maximum trade amount in USDC (e.g., 50): '
        );
        const maxTradeAmountUsdc = parseFloat(maxTradeInput) || 50;

        // Trading Interval
        const intervalInput = await askQuestion(
            rl,
            '⏱️  Trading interval in seconds (e.g., 30): '
        );
        const tradingIntervalMs = (parseFloat(intervalInput) || 30) * 1000;

        // Slippage
        const slippageInput = await askQuestion(
            rl,
            '📊 Slippage tolerance in BPS (e.g., 50 = 0.5%): '
        );
        const slippageBps = parseInt(slippageInput) || 50;

        rl.close();

        console.log('\n✅ Configuration complete!\n');

        return {
            rpcUrl,
            privateKey,
            tokenAddress,
            usdcAddress,
            routerAddress,
            minTradeAmountUsdc,
            maxTradeAmountUsdc,
            tradingIntervalMs,
            slippageBps,
            // Hardcoded values
            summaryIntervalMs: HARDCODED_DEFAULTS.SUMMARY_INTERVAL_SECONDS * 1000,
            deadlineSeconds: HARDCODED_DEFAULTS.DEADLINE_SECONDS,
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
