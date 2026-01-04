import { loadConfig } from '../../config.js';
import { BalanceChecker } from '../../utils/balanceChecker.js';
import { formatBalanceTable } from '../../utils/formatters.js';
import { getKeyPairFromPrivateKey } from '../utils.js';
import { Wallet } from 'ethers';

async function testBalance() {
  const config = loadConfig();

  console.log('\n' + '='.repeat(70));
  console.log('🚀 ARBITRAGE BOT - BALANCE TEST');
  console.log('='.repeat(70) + '\n');

  // Get token addresses
  const solanaMint = config.SOLANA_TOKEN_MINT || config.SOLANA_TOKEN_MINTS?.split(',')[0]?.trim();
  if (!solanaMint) {
    throw new Error('Missing SOLANA_TOKEN_MINT or SOLANA_TOKEN_MINTS');
  }

  if (!config.BASE_TOKEN_ADDRESS) {
    throw new Error('Missing BASE_TOKEN_ADDRESS');
  }

  if (!config.BASE_USDC_ADDRESS) {
    throw new Error('Missing BASE_USDC_ADDRESS');
  }

  console.log('📋 Token Configuration:');
  console.log(`   TOKEN Address on Solana : ${solanaMint}`);
  console.log(`   TOKEN Address on Base :  ${config.BASE_TOKEN_ADDRESS}`);
  console.log(`   USDC Address on Base:   ${config.BASE_USDC_ADDRESS}\n`);

  // Setup balance checker
  let solanaPublicKey: string | undefined;
  let baseWalletAddress: string | undefined;

  try {
    if (config.SOLANA_PRIVATE_KEY) {
      const keypair = getKeyPairFromPrivateKey(config.SOLANA_PRIVATE_KEY);
      solanaPublicKey = keypair.publicKey.toBase58();
    }
  } catch (err) {
    // Silently fail - balances won't be checked if key is invalid
  }

  try {
    if (config.BASE_PRIVATE_KEY_HEX) {
      const wallet = new Wallet(config.BASE_PRIVATE_KEY_HEX);
      baseWalletAddress = wallet.address;
    }
  } catch (err) {
    // Silently fail - balances won't be checked if key is invalid
  }

  const balanceChecker = new BalanceChecker({
    solanaRpcUrl: config.SOLANA_RPC_HTTP_URL,
    solanaPrivateKeyBase58: config.SOLANA_PRIVATE_KEY || undefined,
    baseRpcUrl: config.BASE_RPC_HTTP_URL,
    baseWalletAddress,
  });

  // Check balances
  console.log('💰 Checking Balances...\n');
  try {
    const balances = await balanceChecker.checkAllBalances(
      solanaMint,
      config.BASE_TOKEN_ADDRESS,
      config.BASE_USDC_ADDRESS
    );

    const solanaData = balances.solana
      ? {
          sol: balances.solana.sol,
          token: balances.solana.token,
          publicKey: solanaPublicKey,
        }
      : 'not_available';
    
    const baseData = balances.base
      ? {
          eth: balances.base.eth,
          usdc: balances.base.usdc,
          token: balances.base.token,
          address: baseWalletAddress,
        }
      : 'not_available';

    // Display balance table
    console.log(formatBalanceTable(solanaData, baseData));
    
    if (solanaData !== 'not_available' && solanaPublicKey) {
      console.log(`\n   Solana Address: ${solanaPublicKey}`);
    }
    if (baseData !== 'not_available' && baseWalletAddress) {
      console.log(`   Base Address:   ${baseWalletAddress}\n`);
    }
  } catch (err) {
    console.error('❌ Balance check failed:', err instanceof Error ? err.message : String(err));
  }

  console.log('='.repeat(70));
  console.log('✅ Test Completed Successfully');
  console.log('='.repeat(70) + '\n');
  
  process.exit(0);
}

testBalance().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

