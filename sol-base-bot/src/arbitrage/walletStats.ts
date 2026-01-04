import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { JsonRpcProvider, Wallet } from 'ethers';
import { getAllBaseBalances } from '../base/baseBalanceUtils.js';
import { getPriceFetcher } from '../utils/priceFetcher.js';
import type { MarketStats } from './marketFetcher.js';

export interface WalletStats {
  solana: {
    sol: number;
    token: number;
    solUsd: number;
    tokenUsd: number;
    totalUsd: number;
  };
  base: {
    eth: number;
    usdc: number;
    token: number;
    ethUsd: number;
    totalUsd: number;
  };
}

/**
 * Fetch wallet statistics for both chains
 */
export async function fetchWalletStats(
  config: {
    SOLANA_TOKEN_MINT: string;
    BASE_TOKEN_ADDRESS: string;
    BASE_USDC_ADDRESS: string;
    SOLANA_SOL_PRICE_USD: number;
    COINMARKETCAP_API_KEY: string;
  },
  solanaConnection: Connection,
  baseProvider: JsonRpcProvider,
  solanaKeypair: Keypair | null,
  baseWallet: Wallet | null,
  currentMarketStats: MarketStats | null
): Promise<WalletStats | null> {
  try {
    // Fetch current prices from CoinMarketCap if API key is provided
    let solPrice = config.SOLANA_SOL_PRICE_USD;
    let ethPrice = 2000; // Default fallback

    if (config.COINMARKETCAP_API_KEY) {
      try {
        const priceFetcher = getPriceFetcher();
        const prices = await priceFetcher.getPrices();
        solPrice = prices.sol;
        ethPrice = prices.eth;
      } catch (error) {
        console.warn('⚠️  Failed to fetch prices from CoinMarketCap, using fallback values:', error);
      }
    }

    let solanaStats = null;
    let baseStats = null;

    if (solanaKeypair) {
      const solBalance = await solanaConnection.getBalance(solanaKeypair.publicKey);
      const sol = solBalance / LAMPORTS_PER_SOL;
      const solUsd = sol * solPrice;

      // Get token balance
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const mint = new PublicKey(config.SOLANA_TOKEN_MINT);
      const tokenAccount = await getAssociatedTokenAddress(mint, solanaKeypair.publicKey);
      
      let token = 0;
      try {
        const accountInfo = await solanaConnection.getTokenAccountBalance(tokenAccount);
        if (accountInfo && accountInfo.value) {
          token = parseFloat(accountInfo.value.uiAmount?.toString() || '0');
        }
      } catch {
        // Token account might not exist
      }

      const tokenUsd = token * (currentMarketStats?.solana.priceUsd || 0);
      solanaStats = {
        sol,
        token,
        solUsd,
        tokenUsd,
        totalUsd: solUsd + tokenUsd,
      };
    }

    if (baseWallet) {
      const balances = await getAllBaseBalances(
        baseProvider,
        config.BASE_TOKEN_ADDRESS,
        config.BASE_USDC_ADDRESS,
        baseWallet.address
      );

      const ethUsd = balances.eth * ethPrice;
      const tokenUsd = balances.token * (currentMarketStats?.base.priceUsd || 0);
      baseStats = {
        eth: balances.eth,
        usdc: balances.usdc,
        token: balances.token,
        ethUsd,
        totalUsd: ethUsd + balances.usdc + tokenUsd,
      };
    }

    if (!solanaStats && !baseStats) {
      return null;
    }

    return {
      solana: solanaStats || { sol: 0, token: 0, solUsd: 0, tokenUsd: 0, totalUsd: 0 },
      base: baseStats || { eth: 0, usdc: 0, token: 0, ethUsd: 0, totalUsd: 0 },
    };
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    return null;
  }
}

