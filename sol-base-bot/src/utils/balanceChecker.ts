import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { JsonRpcProvider, formatUnits, Contract } from 'ethers';
import { getKeyPairFromPrivateKey } from '../solana/utils.js';

const erc20Abi = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export interface SolanaBalance {
  sol: number;
  token: number;
  tokenMint: string;
}

export interface BaseBalance {
  eth: number;
  usdc: number;
  token: number;
  tokenAddress: string;
  usdcAddress: string;
}

export class BalanceChecker {
  private readonly solanaConnection: Connection;
  private readonly baseProvider: JsonRpcProvider;
  private readonly solanaKeypair: { publicKey: PublicKey } | null = null;

  constructor(
    private readonly params: {
      solanaRpcUrl: string;
      solanaPrivateKeyBase58?: string;
      baseRpcUrl: string;
      baseWalletAddress?: string;
    }
  ) {
    this.solanaConnection = new Connection(params.solanaRpcUrl, 'confirmed');
    this.baseProvider = new JsonRpcProvider(params.baseRpcUrl);
    
    if (params.solanaPrivateKeyBase58) {
      try {
        const keypair = getKeyPairFromPrivateKey(params.solanaPrivateKeyBase58);
        this.solanaKeypair = { publicKey: keypair.publicKey };
      } catch (err) {
        // Invalid key format, will check balances by address if provided
      }
    }
  }

  async checkSolanaBalance(tokenMint: string): Promise<SolanaBalance | null> {
    if (!this.solanaKeypair) {
      throw new Error('Solana private key required to check balances');
    }

    try {
      const publicKey = this.solanaKeypair.publicKey;
      
      // Get SOL balance
      const solBalance = await this.solanaConnection.getBalance(publicKey);
      const sol = solBalance / LAMPORTS_PER_SOL;

      // Get token balance
      let token = 0;
      try {
        const tokenMintPubkey = new PublicKey(tokenMint);
        const tokenAccount = await getAssociatedTokenAddress(
          tokenMintPubkey,
          publicKey
        );
        
        const accountInfo = await this.solanaConnection.getTokenAccountBalance(tokenAccount);
        if (accountInfo && accountInfo.value) {
          token = parseFloat(accountInfo.value.uiAmount?.toString() || '0');
        }
      } catch {
        // Token account might not exist yet
        token = 0;
      }

      return {
        sol,
        token,
        tokenMint,
      };
    } catch (err) {
      throw new Error(`Failed to check Solana balance: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async checkBaseBalance(
    tokenAddress: string,
    usdcAddress: string
  ): Promise<BaseBalance | null> {
    if (!this.params.baseWalletAddress) {
      throw new Error('Base wallet address required to check balances');
    }

    try {
      const walletAddress = this.params.baseWalletAddress;

      // Get ETH balance
      const ethBalance = await this.baseProvider.getBalance(walletAddress);
      const eth = parseFloat(formatUnits(ethBalance, 18));

      // Get USDC balance
      let usdc = 0;
      try {
        const usdcContract = new Contract(
          usdcAddress,
          erc20Abi,
          this.baseProvider
        );
        const usdcDecimals = await usdcContract.decimals();
        const usdcBalance = await usdcContract.balanceOf(walletAddress);
        usdc = parseFloat(formatUnits(usdcBalance, usdcDecimals));
      } catch (err) {
        // USDC contract might not be accessible
        usdc = 0;
      }

      // Get token balance
      let token = 0;
      try {
        const tokenContract = new Contract(
          tokenAddress,
          erc20Abi,
          this.baseProvider
        );
        const tokenDecimals = await tokenContract.decimals();
        const tokenBalance = await tokenContract.balanceOf(walletAddress);
        token = parseFloat(formatUnits(tokenBalance, tokenDecimals));
      } catch (err) {
        // Token account might not exist yet
        token = 0;
      }

      return {
        eth,
        usdc,
        token,
        tokenAddress,
        usdcAddress,
      };
    } catch (err) {
      throw new Error(`Failed to check Base balance: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async checkAllBalances(
    tokenMint: string,
    tokenAddress: string,
    usdcAddress: string
  ): Promise<{ solana: SolanaBalance | null; base: BaseBalance | null }> {
    const [solana, base] = await Promise.all([
      this.checkSolanaBalance(tokenMint).catch(() => null),
      this.checkBaseBalance(tokenAddress, usdcAddress).catch(() => null),
    ]);

    return { solana, base };
  }
}

