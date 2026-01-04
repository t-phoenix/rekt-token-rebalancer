import axios from 'axios';

export interface TokenPrices {
  sol: number;
  eth: number;
  lastUpdated: number;
}

/**
 * CoinMarketCap API price fetcher for SOL and ETH
 * 
 * Coin IDs:
 * - SOL (Solana): 5426
 * - ETH (Ethereum): 1027
 */
export class PriceFetcher {
  private apiKey: string;
  private cache: TokenPrices | null = null;
  private cacheTimeout: number = 60000; // 1 minute cache
  private lastFetchTime: number = 0;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('CoinMarketCap API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Fetch current prices for SOL and ETH from CoinMarketCap
   */
  async fetchPrices(): Promise<TokenPrices> {
    // Return cached prices if still valid
    if (this.cache && Date.now() - this.lastFetchTime < this.cacheTimeout) {
      return this.cache;
    }

    try {
      const response = await axios.get(
        'https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest',
        {
          params: {
            id: '5426,1027', // SOL and ETH
            convert: 'USD',
          },
          headers: {
            'X-CMC_PRO_API_KEY': this.apiKey,
            'Accept': 'application/json',
          },
        }
      );

      const data = response.data.data;
      
      const solPrice = data['5426']?.quote?.USD?.price;
      const ethPrice = data['1027']?.quote?.USD?.price;

      if (!solPrice || !ethPrice) {
        throw new Error('Failed to fetch prices from CoinMarketCap');
      }

      const prices: TokenPrices = {
        sol: solPrice,
        eth: ethPrice,
        lastUpdated: Date.now(),
      };

      // Update cache
      this.cache = prices;
      this.lastFetchTime = Date.now();

      return prices;
    } catch (error) {
      // If we have cached prices, return them even if expired
      if (this.cache) {
        console.warn('⚠️  Failed to fetch new prices, using cached values');
        return this.cache;
      }

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error('Invalid CoinMarketCap API key');
        } else if (error.response?.status === 429) {
          throw new Error('CoinMarketCap API rate limit exceeded');
        } else {
          throw new Error(`CoinMarketCap API error: ${error.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Get SOL price in USD
   */
  async getSolPrice(): Promise<number> {
    const prices = await this.fetchPrices();
    return prices.sol;
  }

  /**
   * Get ETH price in USD
   */
  async getEthPrice(): Promise<number> {
    const prices = await this.fetchPrices();
    return prices.eth;
  }

  /**
   * Get both prices
   */
  async getPrices(): Promise<{ sol: number; eth: number }> {
    const prices = await this.fetchPrices();
    return {
      sol: prices.sol,
      eth: prices.eth,
    };
  }

  /**
   * Clear the cache to force a fresh fetch on next call
   */
  clearCache(): void {
    this.cache = null;
    this.lastFetchTime = 0;
  }
}

/**
 * Global price fetcher instance
 */
let globalPriceFetcher: PriceFetcher | null = null;

/**
 * Initialize the global price fetcher
 */
export function initializePriceFetcher(apiKey: string): PriceFetcher {
  globalPriceFetcher = new PriceFetcher(apiKey);
  return globalPriceFetcher;
}

/**
 * Get the global price fetcher instance
 */
export function getPriceFetcher(): PriceFetcher {
  if (!globalPriceFetcher) {
    throw new Error('Price fetcher not initialized. Call initializePriceFetcher() first.');
  }
  return globalPriceFetcher;
}

