import { JsonRpcProvider, Wallet } from 'ethers';
import { getAllBaseBalances, BaseBalance } from '../baseBalanceUtils.js';
import { TradeRecord, PnLSummary } from './volumeBotTypes.js';

/**
 * Volume tracker class for managing trade history and P&L calculations
 */
export class VolumeTracker {
    private trades: TradeRecord[] = [];
    private initialEthBalance: number = 0;
    private initialUsdcBalance: number = 0;
    private initialTokenBalance: number = 0;

    setInitialBalances(eth: number, usdc: number, token: number) {
        this.initialEthBalance = eth;
        this.initialUsdcBalance = usdc;
        this.initialTokenBalance = token;
    }

    addTrade(trade: TradeRecord) {
        this.trades.push(trade);
    }

    getTrades(): TradeRecord[] {
        return this.trades;
    }

    calculatePnL(currentEth: number, currentUsdc: number, currentToken: number, ethPriceUsd: number): PnLSummary {
        const buyTrades = this.trades.filter(t => t.direction === 'BUY' && t.success);
        const sellTrades = this.trades.filter(t => t.direction === 'SELL' && t.success);

        const totalBuyVolumeUsdc = buyTrades.reduce((sum, t) => sum + t.usdcAmount, 0);
        const totalSellVolumeUsdc = sellTrades.reduce((sum, t) => sum + t.usdcAmount, 0);

        const totalBuyVolumeUsd = buyTrades.reduce((sum, t) => sum + t.usdValue, 0);
        const totalSellVolumeUsd = sellTrades.reduce((sum, t) => sum + t.usdValue, 0);

        const totalGasUsedEth = this.trades.reduce((sum, t) => sum + t.gasUsedEth, 0);
        const totalGasUsedUsd = totalGasUsedEth * ethPriceUsd;

        // Net USDC change: positive means we received more than we spent
        const netUsdcChange = totalSellVolumeUsdc - totalBuyVolumeUsdc;

        // Estimate PnL: Current value - Initial value (in USD)
        const initialValueUsd = this.initialUsdcBalance;
        const currentValueUsd = currentUsdc;
        const estimatedPnlUsd = currentValueUsd - initialValueUsd - totalGasUsedUsd;

        return {
            totalBuys: buyTrades.length,
            totalSells: sellTrades.length,
            totalBuyVolumeUsdc,
            totalSellVolumeUsdc,
            totalBuyVolumeUsd,
            totalSellVolumeUsd,
            totalGasUsedEth,
            totalGasUsedUsd,
            netUsdcChange,
            currentEthBalance: currentEth,
            currentUsdcBalance: currentUsdc,
            currentTokenBalance: currentToken,
            estimatedPnlUsd,
        };
    }
}

/**
 * Get current wallet balances for ETH, USDC and tokens
 */
export async function getWalletBalances(
    provider: JsonRpcProvider,
    walletAddress: string,
    tokenAddress: string,
    usdcAddress: string
): Promise<{ eth: number; usdc: number; token: number }> {
    try {
        const balances = await getAllBaseBalances(
            provider,
            tokenAddress,
            usdcAddress,
            walletAddress
        );

        return {
            eth: balances.eth,
            usdc: balances.usdc,
            token: balances.token,
        };
    } catch (error) {
        console.error('Error fetching wallet balances:', error);
        return { eth: 0, usdc: 0, token: 0 };
    }
}
