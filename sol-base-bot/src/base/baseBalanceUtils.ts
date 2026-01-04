import { JsonRpcProvider, formatUnits, Contract } from 'ethers';
import erc20Abi from './abi/ERC20.json' with { type: "json" };


export interface BaseBalance {
  eth: number;
  usdc: number;
  token: number;
  tokenAddress: string;
  usdcAddress: string;
  walletAddress: string;
}

/**
 * Creates a Base network provider
 */
export function createBaseProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl);
}

/**
 * Gets ETH balance for a wallet address on Base
 */
export async function getEthBalance(
  provider: JsonRpcProvider,
  walletAddress: string
): Promise<number> {
  try {
    const ethBalance = await provider.getBalance(walletAddress);
    return parseFloat(formatUnits(ethBalance, 18));
  } catch (err) {
    throw new Error(
      `Failed to get ETH balance: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Gets ERC20 token balance for a wallet address on Base
 */
export async function getTokenBalance(
  provider: JsonRpcProvider,
  tokenAddress: string,
  walletAddress: string
): Promise<number> {
  try {
    const tokenContract = new Contract(tokenAddress, erc20Abi, provider);
    const tokenDecimals = await tokenContract.decimals();
    const tokenBalance = await tokenContract.balanceOf(walletAddress);
    return parseFloat(formatUnits(tokenBalance, tokenDecimals));
  } catch (err) {
    // Token account might not exist yet or contract might not be accessible
    return 0;
  }
}

/**
 * Gets USDC balance for a wallet address on Base
 */
export async function getUsdcBalance(
  provider: JsonRpcProvider,
  usdcAddress: string,
  walletAddress: string
): Promise<number> {
  try {
    const usdcContract = new Contract(usdcAddress, erc20Abi, provider);
    const usdcDecimals = await usdcContract.decimals();
    const usdcBalance = await usdcContract.balanceOf(walletAddress);
    return parseFloat(formatUnits(usdcBalance, usdcDecimals));
  } catch (err) {
    // USDC contract might not be accessible
    return 0;
  }
}

/**
 * Gets all Base balances (ETH, USDC, and Token) for a wallet address
 */
export async function getAllBaseBalances(
  provider: JsonRpcProvider,
  tokenAddress: string,
  usdcAddress: string,
  walletAddress: string
): Promise<BaseBalance> {
  try {
    const [eth, usdc, token] = await Promise.all([
      getEthBalance(provider, walletAddress),
      getUsdcBalance(provider, usdcAddress, walletAddress),
      getTokenBalance(provider, tokenAddress, walletAddress),
    ]);

    return {
      eth,
      usdc,
      token,
      tokenAddress,
      usdcAddress,
      walletAddress,
    };
  } catch (err) {
    throw new Error(
      `Failed to get Base balances: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

