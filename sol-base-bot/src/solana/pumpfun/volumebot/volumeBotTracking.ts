import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { TradeRecord, PnLSummary } from './volumeBotTypes.js';

/**
 * Volume tracker class for managing trade history and P&L calculations
 */
export class VolumeTracker {
    private trades: TradeRecord[] = [];
    private initialSolBalance: number = 0;
    private initialTokenBalance: number = 0;

    setInitialBalances(sol: number, token: number) {
        this.initialSolBalance = sol;
        this.initialTokenBalance = token;
    }

    addTrade(trade: TradeRecord) {
        this.trades.push(trade);
    }

    getTrades(): TradeRecord[] {
        return this.trades;
    }

    calculatePnL(currentSol: number, currentToken: number, solPriceUsd: number): PnLSummary {
        const buyTrades = this.trades.filter(t => t.direction === 'BUY' && t.success);
        const sellTrades = this.trades.filter(t => t.direction === 'SELL' && t.success);

        const totalBuyVolumeSol = buyTrades.reduce((sum, t) => sum + t.solAmount, 0);
        const totalSellVolumeSol = sellTrades.reduce((sum, t) => sum + t.solAmount, 0);

        const totalBuyVolumeUsd = buyTrades.reduce((sum, t) => sum + t.usdValue, 0);
        const totalSellVolumeUsd = sellTrades.reduce((sum, t) => sum + t.usdValue, 0);

        const totalGasUsedSol = this.trades.reduce((sum, t) => sum + t.gasUsedSol, 0);
        const totalGasUsedUsd = totalGasUsedSol * solPriceUsd;

        // Net SOL change: negative means we spent more than we received
        const netSolChange = totalSellVolumeSol - totalBuyVolumeSol;

        // Estimate PnL: Current value - Initial value
        const initialValueUsd = this.initialSolBalance * solPriceUsd;
        const currentValueUsd = currentSol * solPriceUsd;
        const estimatedPnlUsd = currentValueUsd - initialValueUsd;

        return {
            totalBuys: buyTrades.length,
            totalSells: sellTrades.length,
            totalBuyVolumeSol,
            totalSellVolumeSol,
            totalBuyVolumeUsd,
            totalSellVolumeUsd,
            totalGasUsedSol,
            totalGasUsedUsd,
            netSolChange,
            currentSolBalance: currentSol,
            currentTokenBalance: currentToken,
            estimatedPnlUsd,
        };
    }
}

/**
 * Get current wallet balances for SOL and tokens
 */
export async function getWalletBalances(
    connection: Connection,
    wallet: Keypair,
    tokenMint: PublicKey
): Promise<{ sol: number; token: number }> {
    try {
        // Get SOL balance
        const solBalance = await connection.getBalance(wallet.publicKey);
        const sol = solBalance / LAMPORTS_PER_SOL;

        // Get token balance
        let token = 0;
        try {
            const tokenAccount = await getAssociatedTokenAddress(
                tokenMint,
                wallet.publicKey
            );
            const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
            if (accountInfo && accountInfo.value) {
                token = parseFloat(accountInfo.value.uiAmount?.toString() || '0');
            }
        } catch {
            // Token account might not exist yet
            token = 0;
        }

        return { sol, token };
    } catch (error) {
        console.error('Error fetching wallet balances:', error);
        return { sol: 0, token: 0 };
    }
}
