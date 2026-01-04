import { loadConfig } from '../../config.js';
import { Wallet } from 'ethers';
import {
  createBaseProvider,
  getAllBaseBalances,
  getEthBalance,
  getTokenBalance,
  getUsdcBalance,
} from '../baseBalanceUtils.js';

async function testGetBaseBalance() {
  const config = loadConfig();

  console.log('\n' + '='.repeat(70));
  console.log('🚀 BASE BALANCE TEST');
  console.log('='.repeat(70) + '\n');

  // Validate required configuration
  if (!config.BASE_RPC_HTTP_URL) {
    throw new Error('Missing BASE_RPC_HTTP_URL in environment variables');
  }

  if (!config.BASE_PRIVATE_KEY_HEX) {
    throw new Error('Missing BASE_PRIVATE_KEY_HEX in environment variables');
  }

  // Get wallet address from private key
  let walletAddress: string;
  try {
    const wallet = new Wallet(config.BASE_PRIVATE_KEY_HEX);
    walletAddress = wallet.address;
  } catch (err) {
    throw new Error(
      `Invalid BASE_PRIVATE_KEY_HEX: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Create provider
  const provider = createBaseProvider(config.BASE_RPC_HTTP_URL);

  console.log('📋 Configuration:');
  console.log(`   Base RPC URL:    ${config.BASE_RPC_HTTP_URL}`);
  console.log(`   Wallet Address:  ${walletAddress}`);
  console.log(`   Token Address:  ${config.BASE_TOKEN_ADDRESS || 'Not set'}`);
  console.log(`   USDC Address:   ${config.BASE_USDC_ADDRESS || 'Not set'}\n`);

  // Check balances
  console.log('💰 Checking Balances...\n');

  try {
    // Get ETH balance
    const ethBalance = await getEthBalance(provider, walletAddress);
    console.log(`   ETH Balance:     ${ethBalance.toFixed(6)} ETH`);

    // Get USDC balance if address is provided
    if (config.BASE_USDC_ADDRESS) {
      const usdcBalance = await getUsdcBalance(
        provider,
        config.BASE_USDC_ADDRESS,
        walletAddress
      );
      console.log(`   USDC Balance:    ${usdcBalance.toFixed(2)} USDC`);
    } else {
      console.log(`   USDC Balance:    Not configured (BASE_USDC_ADDRESS not set)`);
    }

    // Get Token balance if address is provided
    if (config.BASE_TOKEN_ADDRESS) {
      const tokenBalance = await getTokenBalance(
        provider,
        config.BASE_TOKEN_ADDRESS,
        walletAddress
      );
      console.log(`   Token Balance:   ${tokenBalance.toFixed(6)} Tokens`);
    } else {
      console.log(`   Token Balance:   Not configured (BASE_TOKEN_ADDRESS not set)`);
    }

    // Get all balances at once (if both addresses are provided)
    if (config.BASE_TOKEN_ADDRESS && config.BASE_USDC_ADDRESS) {
      console.log('\n   📊 All Balances Summary:');
      const allBalances = await getAllBaseBalances(
        provider,
        config.BASE_TOKEN_ADDRESS,
        config.BASE_USDC_ADDRESS,
        walletAddress
      );
      console.log(`      ETH:   ${allBalances.eth.toFixed(6)} ETH`);
      console.log(`      USDC:  ${allBalances.usdc.toFixed(2)} USDC`);
      console.log(`      Token: ${allBalances.token.toFixed(6)} Tokens`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ Test Completed Successfully');
    console.log('='.repeat(70) + '\n');
  } catch (err) {
    console.error('❌ Balance check failed:', err instanceof Error ? err.message : String(err));
    throw err;
  }

  process.exit(0);
}

testGetBaseBalance().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

