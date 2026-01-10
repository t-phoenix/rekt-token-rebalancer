import { Wallet, JsonRpcProvider, parseUnits, formatUnits, Contract, formatEther } from 'ethers';
import { getTokenDecimals } from '../uniswap/router.js';
import { TradeRecord } from './volumeBotTypes.js';
import uniswapRouterAbi from '../abi/UniswapRouter02.json' with { type: "json" };
import erc20Abi from '../abi/ERC20.json' with { type: "json" };

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
 * Execute a buy trade on Base via Uniswap V2
 * Buys tokens with exact USDC amount
 */
export async function executeBuyTrade(
    provider: JsonRpcProvider,
    wallet: Wallet,
    routerAddress: string,
    usdcAddress: string,
    tokenAddress: string,
    usdcAmount: number,
    slippageBps: number,
    deadlineSeconds: number
): Promise<TradeRecord> {
    const timestamp = new Date();
    const direction = 'BUY';

    try {
        console.log(`\n🟢 Executing BUY: ${usdcAmount.toFixed(6)} USDC`);

        // Round USDC amount to 6 decimals
        const roundedUsdcAmount = Math.floor(usdcAmount * 1e6) / 1e6;
        const usdcAmountBigInt = parseUnits(roundedUsdcAmount.toFixed(6), 6);
        console.log(`   🔍 Input: ${usdcAmountBigInt} units of USDC`);

        // Get token decimals
        const tokenDecimals = Number(await getTokenDecimals(provider, tokenAddress));

        // Simulate: Sell exact USDC for tokens (path: USDC -> Token)
        const router = new Contract(routerAddress, uniswapRouterAbi, provider);
        const path = [usdcAddress, tokenAddress];

        console.log(`   🔮 Simulating getAmountsOut...`);
        let tokensOut = BigInt(0);
        try {
            const amounts = await router.getAmountsOut(usdcAmountBigInt, path);
            tokensOut = amounts[1]; // Tokens we'll receive
        } catch (err) {
            console.log(`   ⚠️ Simulation failed (might be zero liquidity or other issue): ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        }

        const estimatedTokens = parseFloat(formatUnits(tokensOut, tokenDecimals));
        console.log(`   💡 Estimated tokens: ${estimatedTokens.toFixed(6)}`);

        // Dynamic Slippage for small amounts:
        // If trade is small (< 0.1 USDC), use minimal or zero slippage protection to prevent reverts on dust
        let minTokensOut = BigInt(0);
        if (roundedUsdcAmount < 0.1) {
            console.log(`   ⚠️ Small trade (< 0.1 USDC), disabling slippage protection (accepting any amount)`);
            minTokensOut = BigInt(0);
        } else {
            const slippageMultiplier = BigInt(10000 - slippageBps);
            minTokensOut = (tokensOut * slippageMultiplier) / BigInt(10000);
            console.log(`   🛡️ Min Tokens Out (Slippage ${slippageBps}bps): ${formatUnits(minTokensOut, tokenDecimals)}`);
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

        console.log(`   💵 USDC cost: ${roundedUsdcAmount.toFixed(6)} USDC`);
        console.log(`   💰 USD value: ~$${roundedUsdcAmount.toFixed(6)}`);

        // Check and handle USDC approval
        const usdcContract = new Contract(usdcAddress, erc20Abi, wallet);
        const allowance = await usdcContract.allowance(wallet.address, routerAddress);

        if (allowance < usdcAmountBigInt) {
            console.log('   ⚠️  Approving USDC...');
            const approveTx = await usdcContract.approve(routerAddress, usdcAmountBigInt);
            console.log(`   ✅ Approval tx: ${approveTx.hash}`);
            await approveTx.wait();
            console.log('   ✅ Approval confirmed');
        }

        // Execute swap: swapExactTokensForTokens (exact USDC in, variable tokens out)
        const routerContract = new Contract(routerAddress, uniswapRouterAbi, wallet);
        console.log(`   🚀 Sending Swap Transaction...`);
        const swapTx = await routerContract.swapExactTokensForTokens(
            usdcAmountBigInt,  // Exact USDC in
            minTokensOut,       // Minimum tokens out (with slippage)
            path,
            wallet.address,
            deadline
        );

        const receipt = await swapTx.wait();
        // Calculate gas used safely
        const gasUsedBigInt = receipt.gasUsed * (receipt.gasPrice || BigInt(0));
        const gasUsed = parseFloat(formatEther(gasUsedBigInt));

        console.log(`   ✅ BUY Success! Tx: ${receipt.hash}`);
        console.log(`   📊 Tokens received: ~${estimatedTokens.toFixed(6)}`);
        console.log(`   ⛽ Gas used: ${gasUsed.toFixed(8)} ETH`);

        return {
            timestamp,
            direction,
            tokenAmount: estimatedTokens,
            usdcAmount: roundedUsdcAmount,
            usdValue: roundedUsdcAmount,
            gasUsedEth: gasUsed,
            transactionHash: receipt.hash,
            success: true,
        };
    } catch (error) {
        console.error(`   ❌ BUY Failed:`, error instanceof Error ? error.message : String(error));

        return {
            timestamp,
            direction,
            tokenAmount: 0,
            usdcAmount: usdcAmount,
            usdValue: usdcAmount,
            gasUsedEth: 0,
            transactionHash: '',
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Execute a sell trade on Base via Uniswap V2
 * Sells exact tokens for USDC
 */
export async function executeSellTrade(
    provider: JsonRpcProvider,
    wallet: Wallet,
    routerAddress: string,
    usdcAddress: string,
    tokenAddress: string,
    tokenAmount: number,
    slippageBps: number,
    deadlineSeconds: number
): Promise<TradeRecord> {
    const timestamp = new Date();
    const direction = 'SELL';

    try {
        console.log(`\n🔴 Executing SELL: ${tokenAmount.toFixed(6)} tokens`);

        // Get token decimals
        // Force Number() cast to be absolutely sure
        let tokenDecimals = 18;
        try {
            const rawDecimals = await getTokenDecimals(provider, tokenAddress);
            tokenDecimals = Number(rawDecimals);
        } catch (e) {
            console.warn(`   ⚠️ Failed to fetch decimals, defaulting to 18: ${e}`);
        }
        console.log(`   📊 Token decimals: ${tokenDecimals}`);

        // Convert token amount to BigInt
        // Handle potential precision timing by re-fixing to decimals
        const fixedTokenAmount = tokenAmount.toFixed(tokenDecimals);
        console.log(`   🔢 Fixed Amount String: ${fixedTokenAmount}`);
        const tokenAmountBigInt = parseUnits(fixedTokenAmount, tokenDecimals);
        console.log(`   🔢 BigInt Input: ${tokenAmountBigInt.toString()}`);

        // Simulate: Sell exact tokens for USDC (path: Token -> USDC)
        const router = new Contract(routerAddress, uniswapRouterAbi, provider);
        const path = [tokenAddress, usdcAddress];

        console.log(`   🔮 Simulating getAmountsOut...`);
        let usdcOut = BigInt(0);
        try {
            const amounts = await router.getAmountsOut(tokenAmountBigInt, path);
            usdcOut = amounts[1]; // USDC we'll receive
        } catch (err) {
            console.log(`   ⚠️ Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        }

        const expectedUsdc = parseFloat(formatUnits(usdcOut, 6)); // USDC has 6 decimals
        console.log(`   💡 Expected USDC: ${expectedUsdc.toFixed(6)} USDC`);

        // Dynamic Slippage for small amounts
        let minUsdcOut = BigInt(0);
        if (expectedUsdc < 0.1) {
            console.log(`   ⚠️ Small trade (< 0.1 USDC value), disabling slippage protection`);
            minUsdcOut = BigInt(0);
        } else {
            const slippageMultiplier = BigInt(10000 - slippageBps);
            minUsdcOut = (usdcOut * slippageMultiplier) / BigInt(10000);
            console.log(`   🛡️ Min USDC Out (Slippage ${slippageBps}bps): ${formatUnits(minUsdcOut, 6)}`);
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

        console.log(`   💰 USD value: ~$${expectedUsdc.toFixed(6)}`);

        // Check and handle token approval
        const tokenContract = new Contract(tokenAddress, erc20Abi, wallet);
        console.log(`   🔐 Checking Allowance...`);
        const allowance = await tokenContract.allowance(wallet.address, routerAddress);
        console.log(`   🔐 Current Allowance: ${allowance.toString()}`);

        if (allowance < tokenAmountBigInt) {
            console.log('   ⚠️  Approving token...');
            const approveTx = await tokenContract.approve(routerAddress, tokenAmountBigInt);
            console.log(`   ✅ Approval tx: ${approveTx.hash}`);
            await approveTx.wait();
            console.log('   ✅ Approval confirmed');
        }

        // Execute swap: swapExactTokensForTokens (exact tokens in, variable USDC out)
        const routerContract = new Contract(routerAddress, uniswapRouterAbi, wallet);
        console.log(`   🚀 Sending Swap Transaction...`);
        const swapTx = await routerContract.swapExactTokensForTokens(
            tokenAmountBigInt, // Exact tokens in
            minUsdcOut,        // Minimum USDC out (with slippage)
            path,
            wallet.address,
            deadline
        );

        const receipt = await swapTx.wait();
        const gasUsedBigInt = receipt.gasUsed * (receipt.gasPrice || BigInt(0));
        const gasUsed = parseFloat(formatEther(gasUsedBigInt));

        console.log(`   ✅ SELL Success! Tx: ${receipt.hash}`);
        console.log(`   💰 USDC received: ${expectedUsdc.toFixed(6)}`);
        console.log(`   ⛽ Gas used: ${gasUsed.toFixed(8)} ETH`);

        return {
            timestamp,
            direction,
            tokenAmount,
            usdcAmount: expectedUsdc,
            usdValue: expectedUsdc,
            gasUsedEth: gasUsed,
            transactionHash: receipt.hash,
            success: true,
        };
    } catch (error) {
        console.error(`   ❌ SELL Failed:`, error instanceof Error ? error.message : String(error));

        return {
            timestamp,
            direction,
            tokenAmount,
            usdcAmount: 0,
            usdValue: 0,
            gasUsedEth: 0,
            transactionHash: '',
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
