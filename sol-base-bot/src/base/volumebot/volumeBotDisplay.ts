import { VolumeConfig, TradeRecord, PnLSummary } from './volumeBotTypes.js';
import { PriceFetcher } from '../../utils/priceFetcher.js';

/**
 * Display bot configuration summary
 */
export function displayConfig(config: VolumeConfig, ethPrice: number, priceFetcher: PriceFetcher | null) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  BOT CONFIGURATION                         ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Token Address:     ${config.tokenAddress.slice(0, 20)}...`);
    console.log(`║ USDC Address:      ${config.usdcAddress.slice(0, 20)}...`);
    console.log(`║ Router Address:    ${config.routerAddress.slice(0, 20)}...`);
    console.log(`║ RPC URL:           ${config.rpcUrl.slice(0, 40)}...`);
    console.log(`║ ETH Price:         $${ethPrice.toFixed(2)} ${priceFetcher ? '(live)' : '(static)'}"`);
    console.log(`║ Trade Range:       ${config.minTradeAmountUsdc} - ${config.maxTradeAmountUsdc} USDC`);
    console.log(`║ Trade Interval:    ${config.tradingIntervalMs / 1000}s`);
    console.log(`║ Summary Interval:  ${config.summaryIntervalMs / 1000}s`);
    console.log(`║ Slippage:          ${config.slippageBps / 100}%`);
    console.log(`║ Deadline:          ${config.deadlineSeconds}s`);
    console.log(`║ Buy Probability:   ${config.buyProbability}%`);
    console.log(`║ Randomize Size:    ${config.randomizeTradeSize ? 'Yes' : 'No'}`);
    console.log(`║ Max Volume:        ${config.maxTotalVolumeUsd > 0 ? '$' + config.maxTotalVolumeUsd : 'Unlimited'}`);
    console.log(`║ Run Duration:      ${config.runDurationMinutes > 0 ? config.runDurationMinutes + ' min' : 'Infinite'}`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');
}

/**
 * Display wallet summary with trading statistics and P&L
 */
export function displaySummary(pnl: PnLSummary) {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                        WALLET SUMMARY                             ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Current ETH Balance:    ${pnl.currentEthBalance.toFixed(6)} ETH`);
    console.log(`║ Current USDC Balance:   ${pnl.currentUsdcBalance.toFixed(2)} USDC`);
    console.log(`║ Current Token Balance:  ${pnl.currentTokenBalance.toFixed(2)} tokens`);
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║                      TRADING STATISTICS                           ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Buys:             ${pnl.totalBuys}`);
    console.log(`║ Total Sells:            ${pnl.totalSells}`);
    console.log(`║ Buy Volume:             ${pnl.totalBuyVolumeUsdc.toFixed(2)} USDC ($${pnl.totalBuyVolumeUsd.toFixed(2)})`);
    console.log(`║ Sell Volume:            ${pnl.totalSellVolumeUsdc.toFixed(2)} USDC ($${pnl.totalSellVolumeUsd.toFixed(2)})`);
    console.log(`║ Total Volume:           $${(pnl.totalBuyVolumeUsd + pnl.totalSellVolumeUsd).toFixed(2)}`);
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║                         GAS USAGE                                 ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Gas Used:         ${pnl.totalGasUsedEth.toFixed(6)} ETH ($${pnl.totalGasUsedUsd.toFixed(2)})`);
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║                      PROFIT & LOSS                                ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Net USDC Change:        ${pnl.netUsdcChange >= 0 ? '+' : ''}${pnl.netUsdcChange.toFixed(2)} USDC`);
    console.log(`║ Estimated PnL:          ${pnl.estimatedPnlUsd >= 0 ? '+$' : '-$'}${Math.abs(pnl.estimatedPnlUsd).toFixed(2)}`);
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
}

/**
 * Display trade history with most recent trades first
 */
export function displayTradeHistory(trades: TradeRecord[], limit: number = 5) {
    const recentTrades = trades.slice(-limit).reverse();

    console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                          RECENT TRADES                                     ║');
    console.log('╠════════════════════════════════════════════════════════════════════════════╣');

    for (const trade of recentTrades) {
        const status = trade.success ? '✅' : '❌';
        const direction = trade.direction === 'BUY' ? '🟢 BUY ' : '🔴 SELL';
        const time = trade.timestamp.toLocaleTimeString();

        console.log(`║ ${status} ${direction} | ${time}`);

        if (trade.direction === 'BUY') {
            console.log(`║    Amount: ${trade.usdcAmount.toFixed(2)} USDC → ${trade.tokenAmount.toFixed(2)} tokens`);
        } else {
            console.log(`║    Amount: ${trade.tokenAmount.toFixed(2)} tokens → ${trade.usdcAmount.toFixed(2)} USDC`);
        }

        console.log(`║    Value: $${trade.usdValue.toFixed(2)} | Gas: ${trade.gasUsedEth.toFixed(6)} ETH`);

        if (trade.success && trade.transactionHash) {
            console.log(`║    Tx Hash: ${trade.transactionHash.slice(0, 20)}...`);
        }

        if (trade.error) {
            console.log(`║    Error: ${trade.error.slice(0, 60)}`);
        }

        console.log('╠════════════════════════════════════════════════════════════════════════════╣');
    }

    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
}
