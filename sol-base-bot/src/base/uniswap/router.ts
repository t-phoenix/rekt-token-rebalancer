import { Contract, Wallet, JsonRpcProvider, formatUnits, parseUnits, formatEther } from 'ethers';
import uniswapRouterAbi from '../abi/UniswapRouter02.json' with { type: "json" };
import erc20Abi from '../abi/ERC20.json' with { type: "json" };

export interface SwapSimulation {
  amountIn: bigint;
  amountInFormatted: number;
  amountOut: bigint;
  amountOutFormatted: number;
  gasEstimate: bigint;
  gasEstimateFormatted: number;
  gasPrice: bigint;
  gasCostEth: bigint;
  gasCostEthFormatted: number;
  path: string[];
  deadline: bigint;
}

export interface SwapResult {
  transactionHash: string;
  blockNumber: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  actualGasCostEth: number;
}

/**
 * Gets the amount of input tokens needed to get exact output tokens
 */
export async function getAmountsIn(
  router: Contract,
  amountOut: bigint,
  path: string[]
): Promise<bigint[]> {
  try {
    const amounts = await router.getAmountsIn(amountOut, path);
    return amounts;
  } catch (err) {
    throw new Error(
      `Failed to get amounts in: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Gets the amount of output tokens for a given input amount
 */
export async function getAmountsOut(
  router: Contract,
  amountIn: bigint,
  path: string[]
): Promise<bigint[]> {
  try {
    const amounts = await router.getAmountsOut(amountIn, path);
    return amounts;
  } catch (err) {
    throw new Error(
      `Failed to get amounts out: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Checks if the router has approval to spend tokens
 */
export async function checkAllowance(
  provider: JsonRpcProvider,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> {
  try {
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);
    const allowance = await tokenContract.allowance(ownerAddress, spenderAddress);
    return allowance;
  } catch (err) {
    throw new Error(
      `Failed to check allowance: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Approves the router to spend tokens
 */
export async function approveToken(
  wallet: Wallet,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint
): Promise<string> {
  try {
    const tokenContract = new Contract(tokenAddress, erc20Abi, wallet);
    const tx = await tokenContract.approve(spenderAddress, amount);
    await tx.wait();
    return tx.hash;
  } catch (err) {
    throw new Error(
      `Failed to approve token: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Gets token decimals
 */
export async function getTokenDecimals(
  provider: JsonRpcProvider,
  tokenAddress: string
): Promise<number> {
  try {
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);
    const decimals = await tokenContract.decimals();
    return Number(decimals);
  } catch (err) {
    throw new Error(
      `Failed to get token decimals: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Simulates a swap to buy exact tokens with USDC
 */
export async function simulateBuyTokensWithUsdc(
  provider: JsonRpcProvider,
  routerAddress: string,
  usdcAddress: string,
  tokenAddress: string,
  amountOut: bigint, // Amount of tokens to buy (in token's smallest unit)
  walletAddress: string,
  slippageBps: number = 50, // 0.5% default slippage
  deadlineSeconds: number = 30
): Promise<SwapSimulation> {
  try {
    const router = new Contract(routerAddress, uniswapRouterAbi, provider);

    // Create swap path: USDC -> Token (or USDC -> WETH -> Token if direct pair doesn't exist)
    // For now, assume direct pair exists. If not, we'd need to check and use WETH as intermediate
    const path = [usdcAddress, tokenAddress];

    // Get amounts needed
    const amounts = await getAmountsIn(router, amountOut, path);
    const amountIn = amounts[0]; // USDC amount needed

    // Apply slippage tolerance (add extra to account for slippage)
    const slippageMultiplier = BigInt(10000 + slippageBps);
    const amountInMax = (amountIn * slippageMultiplier) / BigInt(10000);

    // Calculate deadline
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    // Get token decimals for formatting
    const [usdcDecimals, tokenDecimals] = await Promise.all([
      getTokenDecimals(provider, usdcAddress),
      getTokenDecimals(provider, tokenAddress),
    ]);

    // Check allowance first - if insufficient, gas estimation will fail
    const allowance = await checkAllowance(
      provider,
      usdcAddress,
      walletAddress,
      routerAddress
    );

    let gasEstimate: bigint;

    // If allowance is sufficient, try to estimate gas
    if (allowance >= amountInMax) {
      try {
        // Estimate gas by encoding the transaction and using provider.estimateGas
        const routerInterface = router.interface;
        const data = routerInterface.encodeFunctionData('swapTokensForExactTokens', [
          amountOut,
          amountInMax,
          path,
          walletAddress,
          deadline,
        ]);

        gasEstimate = await provider.estimateGas({
          to: routerAddress,
          from: walletAddress,
          data,
        });
      } catch (err) {
        // If estimation fails even with allowance, use static estimate
        // This can happen due to various reasons (state changes, etc.)
        gasEstimate = BigInt(200000); // Typical Uniswap V2 swap gas usage
      }
    } else {
      // If allowance is insufficient, use static estimate
      // (approval will be needed, but we can't estimate without it)
      gasEstimate = BigInt(200000); // Typical Uniswap V2 swap gas usage
    }

    // Get current gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(0);
    const gasCostEth = gasEstimate * gasPrice;

    return {
      amountIn,
      amountInFormatted: parseFloat(formatUnits(amountIn, usdcDecimals)),
      amountOut,
      amountOutFormatted: parseFloat(formatUnits(amountOut, tokenDecimals)),
      gasEstimate,
      gasEstimateFormatted: Number(gasEstimate),
      gasPrice,
      gasCostEth,
      gasCostEthFormatted: parseFloat(formatEther(gasCostEth)),
      path,
      deadline,
    };
  } catch (err) {
    throw new Error(
      `Failed to simulate swap: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Simulates a swap to sell exact tokens for USDC
 */
export async function simulateSellTokensForUsdc(
  provider: JsonRpcProvider,
  routerAddress: string,
  usdcAddress: string,
  tokenAddress: string,
  amountIn: bigint, // Amount of tokens to sell (in token's smallest unit)
  walletAddress: string,
  slippageBps: number = 50, // 0.5% default slippage
  deadlineSeconds: number = 30
): Promise<SwapSimulation> {
  try {
    const router = new Contract(routerAddress, uniswapRouterAbi, provider);

    // Create swap path: Token -> USDC
    const path = [tokenAddress, usdcAddress];

    // Get amounts out
    const amounts = await getAmountsOut(router, amountIn, path);
    const amountOut = amounts[amounts.length - 1]; // USDC amount out

    // Apply slippage tolerance (subtract to account for slippage)
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const amountOutMin = (amountOut * slippageMultiplier) / BigInt(10000);

    // Calculate deadline
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

    // Get token decimals for formatting
    const [usdcDecimals, tokenDecimals] = await Promise.all([
      getTokenDecimals(provider, usdcAddress),
      getTokenDecimals(provider, tokenAddress),
    ]);

    // Check allowance first - if insufficient, gas estimation will fail
    const allowance = await checkAllowance(
      provider,
      tokenAddress,
      walletAddress,
      routerAddress
    );

    let gasEstimate: bigint;

    // If allowance is sufficient, try to estimate gas
    if (allowance >= amountIn) {
      try {
        // Estimate gas by encoding the transaction and using provider.estimateGas
        const routerInterface = router.interface;
        const data = routerInterface.encodeFunctionData('swapExactTokensForTokens', [
          amountIn,
          amountOutMin,
          path,
          walletAddress,
          deadline,
        ]);

        gasEstimate = await provider.estimateGas({
          to: routerAddress,
          from: walletAddress,
          data,
        });
      } catch (err) {
        // If estimation fails even with allowance, use static estimate
        // This can happen due to various reasons (state changes, etc.)
        gasEstimate = BigInt(200000); // Typical Uniswap V2 swap gas usage
      }
    } else {
      // If allowance is insufficient, use static estimate
      // (approval will be needed, but we can't estimate without it)
      gasEstimate = BigInt(200000); // Typical Uniswap V2 swap gas usage
    }

    // Get current gas price
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || BigInt(0);
    const gasCostEth = gasEstimate * gasPrice;

    return {
      amountIn,
      amountInFormatted: parseFloat(formatUnits(amountIn, tokenDecimals)),
      amountOut,
      amountOutFormatted: parseFloat(formatUnits(amountOut, usdcDecimals)),
      gasEstimate,
      gasEstimateFormatted: Number(gasEstimate),
      gasPrice,
      gasCostEth,
      gasCostEthFormatted: parseFloat(formatEther(gasCostEth)),
      path,
      deadline,
    };
  } catch (err) {
    throw new Error(
      `Failed to simulate swap: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Executes a swap to sell exact tokens for USDC
 */
export async function sellTokensForUsdc(
  wallet: Wallet,
  routerAddress: string,
  usdcAddress: string,
  tokenAddress: string,
  amountIn: bigint, // Amount of tokens to sell
  amountOutMin: bigint, // Minimum USDC to receive (with slippage)
  deadline: bigint,
  slippageBps: number = 50
): Promise<SwapResult> {
  try {
    const router = new Contract(routerAddress, uniswapRouterAbi, wallet);

    // Create swap path
    const path = [tokenAddress, usdcAddress];

    // Check and approve if needed
    if (!wallet.provider) {
      throw new Error('Wallet provider is not set');
    }
    const allowance = await checkAllowance(
      wallet.provider as JsonRpcProvider,
      tokenAddress,
      wallet.address,
      routerAddress
    );

    if (allowance < amountIn) {
      console.log('   ⚠️  Insufficient allowance. Approving token...');
      const approveTxHash = await approveToken(wallet, tokenAddress, routerAddress, amountIn);
      console.log(`   ✅ Approval transaction sent: ${approveTxHash}`);

      // Wait for approval to be confirmed (critical!)
      console.log('   ⏳ Waiting for approval confirmation...');
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      console.log('   ✅ Approval confirmed');
    }

    // Execute swap
    const tx = await router.swapExactTokensForTokens(
      amountIn,
      amountOutMin,
      path,
      wallet.address,
      deadline
    );

    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }

    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.gasPrice || BigInt(0);
    const actualGasCostEth = parseFloat(formatEther(gasUsed * effectiveGasPrice));

    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed,
      effectiveGasPrice,
      actualGasCostEth,
    };
  } catch (err) {
    throw new Error(
      `Failed to execute swap: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Executes a swap to buy exact tokens with USDC
 */
export async function buyTokensWithUsdc(
  wallet: Wallet,
  routerAddress: string,
  usdcAddress: string,
  tokenAddress: string,
  amountOut: bigint, // Amount of tokens to buy
  amountInMax: bigint, // Maximum USDC to spend (with slippage)
  deadline: bigint,
  slippageBps: number = 50
): Promise<SwapResult> {
  try {
    const router = new Contract(routerAddress, uniswapRouterAbi, wallet);

    // Create swap path
    const path = [usdcAddress, tokenAddress];

    // Check and approve if needed
    if (!wallet.provider) {
      throw new Error('Wallet provider is not set');
    }
    const allowance = await checkAllowance(
      wallet.provider as JsonRpcProvider,
      usdcAddress,
      wallet.address,
      routerAddress
    );

    if (allowance < amountInMax) {
      console.log('   ⚠️  Insufficient allowance. Approving token...');
      const approveTxHash = await approveToken(wallet, usdcAddress, routerAddress, amountInMax);
      console.log(`   ✅ Approval successful: ${approveTxHash}`);
    }

    // Execute swap
    const tx = await router.swapTokensForExactTokens(
      amountOut,
      amountInMax,
      path,
      wallet.address,
      deadline
    );

    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }

    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.gasPrice || BigInt(0);
    const actualGasCostEth = parseFloat(formatEther(gasUsed * effectiveGasPrice));

    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed,
      effectiveGasPrice,
      actualGasCostEth,
    };
  } catch (err) {
    throw new Error(
      `Failed to execute swap: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

