import { VolumeConfig, TradeRecord, PnLSummary } from './volumeBotTypes.js';
import { PriceFetcher } from '../../../utils/priceFetcher.js';

/**
 * Display bot configuration summary
 */
export function displayConfig(config: VolumeConfig, solPrice: number, priceFetcher: PriceFetcher | null) {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                  BOT CONFIGURATION                         ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Token Mint:        ${config.tokenMint.slice(0, 20)}...`);
    console.log(`║ RPC URL:           ${config.rpcUrl.slice(0, 40)}...`);
    console.log(`║ SOL Price:         $${solPrice.toFixed(2)} ${priceFetcher ? '(live)' : '(static)'}`);
    console.log(`║ Trade Range:       ${config.minTradeAmountSol} - ${config.maxTradeAmountSol} SOL`);
    console.log(`║ Trade Interval:    ${config.tradingIntervalMs / 1000}s`);
    console.log(`║ Summary Interval:  ${config.summaryIntervalMs / 1000}s`);
    console.log(`║ Priority Fee:      ${config.priorityFeeSol} SOL`);
    console.log(`║ Slippage:          ${config.slippagePercent}%`);
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
    console.log(`║ Current SOL Balance:    ${pnl.currentSolBalance.toFixed(6)} SOL`);
    console.log(`║ Current Token Balance:  ${pnl.currentTokenBalance.toFixed(2)} tokens`);
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║                      TRADING STATISTICS                           ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Buys:             ${pnl.totalBuys}`);
    console.log(`║ Total Sells:            ${pnl.totalSells}`);
    console.log(`║ Buy Volume:             ${pnl.totalBuyVolumeSol.toFixed(6)} SOL ($${pnl.totalBuyVolumeUsd.toFixed(2)})`);
    console.log(`║ Sell Volume:            ${pnl.totalSellVolumeSol.toFixed(6)} SOL ($${pnl.totalSellVolumeUsd.toFixed(2)})`);
    console.log(`║ Total Volume:           $${(pnl.totalBuyVolumeUsd + pnl.totalSellVolumeUsd).toFixed(2)}`);
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║                         GAS USAGE                                 ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Gas Used:         ${pnl.totalGasUsedSol.toFixed(6)} SOL ($${pnl.totalGasUsedUsd.toFixed(2)})`);
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║                      PROFIT & LOSS                                ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log(`║ Net SOL Change:         ${pnl.netSolChange >= 0 ? '+' : ''}${pnl.netSolChange.toFixed(6)} SOL`);
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
            console.log(`║    Amount: ${trade.solAmount.toFixed(6)} SOL → ${trade.tokenAmount.toFixed(2)} tokens`);
        } else {
            console.log(`║    Amount: ${trade.tokenAmount.toFixed(2)} tokens → ${trade.solAmount.toFixed(6)} SOL`);
        }

        console.log(`║    Value: $${trade.usdValue.toFixed(2)} | Gas: ${trade.gasUsedSol.toFixed(6)} SOL`);

        if (trade.success && trade.signature) {
            console.log(`║    Signature: ${trade.signature.slice(0, 20)}...`);
        }

        if (trade.error) {
            console.log(`║    Error: ${trade.error.slice(0, 60)}`);
        }

        console.log('╠════════════════════════════════════════════════════════════════════════════╣');
    }

    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');
}
