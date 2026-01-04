import { loadConfig } from '../../config.js';
import { Wallet, formatUnits, parseUnits, formatEther } from 'ethers';
import { createBaseProvider, getAllBaseBalances } from '../baseBalanceUtils.js';
import {
  simulateBuyTokensWithUsdc,
  buyTokensWithUsdc,
  getTokenDecimals,
} from '../uniswap/router.js';
import { createReadlineInterface, promptConfirmation } from '../../utils/cliUtils.js';
import { formatNumber } from '../../utils/formatters.js';

async function testBuyToken() {
  const config = loadConfig();
  const rl = createReadlineInterface();

  console.log('\n' + '='.repeat(70));
  console.log('🚀 BASE TOKEN BUY TEST - UNISWAP V2 ROUTER 02');
  console.log('='.repeat(70) + '\n');

  // Validate required configuration
  if (!config.BASE_RPC_HTTP_URL) {
    throw new Error('Missing BASE_RPC_HTTP_URL in environment variables');
  }

  if (!config.BASE_PRIVATE_KEY_HEX) {
    throw new Error('Missing BASE_PRIVATE_KEY_HEX in environment variables');
  }

  if (!config.UNISWAP_V2_ROUTER02_ADDRESS) {
    throw new Error('Missing UNISWAP_V2_ROUTER02_ADDRESS in environment variables');
  }

  if (!config.BASE_USDC_ADDRESS) {
    throw new Error('Missing BASE_USDC_ADDRESS in environment variables');
  }

  if (!config.BASE_TOKEN_ADDRESS) {
    throw new Error('Missing BASE_TOKEN_ADDRESS in environment variables');
  }

  // Get wallet from private key
  let wallet: Wallet;
  let provider: ReturnType<typeof createBaseProvider>;
  try {
    provider = createBaseProvider(config.BASE_RPC_HTTP_URL);
    wallet = new Wallet(config.BASE_PRIVATE_KEY_HEX, provider);
  } catch (err) {
    throw new Error(
      `Invalid BASE_PRIVATE_KEY_HEX: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const walletAddress = wallet.address;

  console.log('📋 Configuration:');
  console.log(`   Base RPC URL:           ${config.BASE_RPC_HTTP_URL}`);
  console.log(`   Wallet Address:         ${walletAddress}`);
  console.log(`   Router Address:         ${config.UNISWAP_V2_ROUTER02_ADDRESS}`);
  console.log(`   USDC Address:           ${config.BASE_USDC_ADDRESS}`);
  console.log(`   Token Address:          ${config.BASE_TOKEN_ADDRESS}`);
  console.log(`   Slippage:               ${config.BASE_SWAP_SLIPPAGE_BPS / 100}%`);
  console.log(`   Deadline:               ${config.BASE_SWAP_DEADLINE_SECONDS}s\n`);

  try {
    // Get initial balances
    console.log('💰 Checking Initial Balances...\n');
    const initialBalances = await getAllBaseBalances(
      provider,
      config.BASE_TOKEN_ADDRESS,
      config.BASE_USDC_ADDRESS,
      walletAddress
    );

    console.log(`   ETH Balance:            ${formatNumber(initialBalances.eth, 6, 18)} ETH`);
    console.log(`   USDC Balance:           ${formatNumber(initialBalances.usdc, 2, 18)} USDC`);
    console.log(`   Token Balance:          ${formatNumber(initialBalances.token, 6, 18)} Tokens\n`);

    // Get token decimals
    const tokenDecimals = await getTokenDecimals(provider, config.BASE_TOKEN_ADDRESS);
    const usdcDecimals = await getTokenDecimals(provider, config.BASE_USDC_ADDRESS);

    // Amount to buy: 1 token
    const amountOut = parseUnits('1', tokenDecimals);

    console.log('🔍 Simulating Transaction...\n');
    console.log(`   Target: Buy exactly 1 token\n`);

    // Simulate the swap
    const simulation = await simulateBuyTokensWithUsdc(
      provider,
      config.UNISWAP_V2_ROUTER02_ADDRESS,
      config.BASE_USDC_ADDRESS,
      config.BASE_TOKEN_ADDRESS,
      amountOut,
      walletAddress,
      config.BASE_SWAP_SLIPPAGE_BPS,
      config.BASE_SWAP_DEADLINE_SECONDS
    );

    // Calculate max USDC needed (with slippage)
    const slippageMultiplier = BigInt(10000 + config.BASE_SWAP_SLIPPAGE_BPS);
    const amountInMax = (simulation.amountIn * slippageMultiplier) / BigInt(10000);

    const usdcMaxFormatted = parseFloat(formatUnits(amountInMax, usdcDecimals));
    
    console.log('📊 Simulation Results:');
    console.log('   ' + '-'.repeat(66));
    console.log(`   Token Amount (out):     ${formatNumber(simulation.amountOutFormatted)} tokens`);
    console.log(`   USDC Amount (in):       ${formatNumber(simulation.amountInFormatted, 2, 18)} USDC`);
    console.log(`   USDC Max (with slippage): ${formatNumber(usdcMaxFormatted, 2, 18)} USDC`);
    console.log(`   Estimated Gas:         ${simulation.gasEstimateFormatted.toLocaleString()} units`);
    console.log(`   Gas Price:             ${formatEther(simulation.gasPrice)} ETH`);
    console.log(`   Estimated Gas Cost:    ${formatNumber(simulation.gasCostEthFormatted, 6, 18)} ETH`);
    console.log(`   Total Cost:            ${formatNumber(simulation.amountInFormatted, 2, 18)} USDC + ${formatNumber(simulation.gasCostEthFormatted, 6, 18)} ETH`);
    console.log('   ' + '-'.repeat(66) + '\n');

    // Check if user has enough balance
    const totalUsdcNeeded = parseFloat(formatUnits(amountInMax, usdcDecimals));
    if (initialBalances.usdc < totalUsdcNeeded) {
      console.error(`❌ Insufficient USDC balance!`);
      console.error(`   Required: ${formatNumber(totalUsdcNeeded, 2, 18)} USDC`);
      console.error(`   Available: ${formatNumber(initialBalances.usdc, 2, 18)} USDC\n`);
      rl.close();
      process.exit(1);
    }

    if (initialBalances.eth < simulation.gasCostEthFormatted * 1.5) {
      console.warn(`⚠️  Low ETH balance for gas!`);
      console.warn(`   Recommended: ${formatNumber(simulation.gasCostEthFormatted * 1.5, 6, 18)} ETH`);
      console.warn(`   Available: ${formatNumber(initialBalances.eth, 6, 18)} ETH\n`);
    }

    // Prompt for confirmation
    console.log('⚠️  Ready to execute transaction!');
    const confirmed = await promptConfirmation(
      rl,
      '   Do you want to proceed? (yes/no): '
    );

    if (!confirmed) {
      console.log('\n❌ Transaction cancelled by user\n');
      rl.close();
      process.exit(0);
    }

    rl.close();

    // Execute the swap
    console.log('\n📤 Executing Transaction...\n');
    const swapResult = await buyTokensWithUsdc(
      wallet,
      config.UNISWAP_V2_ROUTER02_ADDRESS,
      config.BASE_USDC_ADDRESS,
      config.BASE_TOKEN_ADDRESS,
      amountOut,
      amountInMax,
      simulation.deadline,
      config.BASE_SWAP_SLIPPAGE_BPS
    );

    console.log('✅ Transaction Successful!');
    console.log('   ' + '-'.repeat(66));
    console.log(`   Transaction Hash:    ${swapResult.transactionHash}`);
    console.log(`   Block Number:             ${swapResult.blockNumber}`);
    console.log(`   Gas Used:                  ${swapResult.gasUsed.toLocaleString()}`);
    console.log(`   Actual Gas Cost:           ${formatNumber(swapResult.actualGasCostEth, 6, 18)} ETH`);
    console.log('   ' + '-'.repeat(66) + '\n');

    // Get final balances
    console.log('💰 Checking Final Balances...\n');
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for state update

    const finalBalances = await getAllBaseBalances(
      provider,
      config.BASE_TOKEN_ADDRESS,
      config.BASE_USDC_ADDRESS,
      walletAddress
    );

    console.log(`   ETH Balance:            ${formatNumber(finalBalances.eth, 6, 18)} ETH`);
    console.log(`   USDC Balance:           ${formatNumber(finalBalances.usdc, 2, 18)} USDC`);
    console.log(`   Token Balance:          ${formatNumber(finalBalances.token, 6, 18)} Tokens\n`);

    // Show balance changes
    console.log('📈 Balance Changes:');
    console.log('   ' + '-'.repeat(66));
    const ethChange = finalBalances.eth - initialBalances.eth;
    const usdcChange = finalBalances.usdc - initialBalances.usdc;
    const tokenChange = finalBalances.token - initialBalances.token;

    console.log(`   ETH:    ${ethChange >= 0 ? '+' : ''}${formatNumber(ethChange, 6, 18)} ETH`);
    console.log(`   USDC:   ${usdcChange >= 0 ? '+' : ''}${formatNumber(usdcChange, 2, 18)} USDC`);
    console.log(`   Token:  ${tokenChange >= 0 ? '+' : ''}${formatNumber(tokenChange, 6, 18)} Tokens`);
    console.log('   ' + '-'.repeat(66) + '\n');

    console.log('='.repeat(70));
    console.log('✅ Test Completed Successfully');
    console.log('='.repeat(70) + '\n');
  } catch (err) {
    rl.close();
    console.error('❌ Transaction failed:', err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error('\nStack trace:', err.stack);
    }
    throw err;
  }

  process.exit(0);
}

testBuyToken().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

