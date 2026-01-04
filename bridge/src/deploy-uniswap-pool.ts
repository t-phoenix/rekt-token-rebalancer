import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits, ZeroAddress } from 'ethers';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '..', '.env') });

// Network-specific Uniswap V2 Router addresses
const UNISWAP_ROUTERS: Record<string, string> = {
  mainnet: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  base: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  sepolia: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3',
};

// ERC20 ABI (minimal for balance, approve, decimals)
const ERC20_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address, uint256) external returns (bool)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
] as const;

// Uniswap V2 Router ABI (minimal for addLiquidity)
const UNISWAP_ROUTER_ABI = [
  'function factory() external pure returns (address)',
  'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
] as const;

// Uniswap V2 Factory ABI
const UNISWAP_FACTORY_ABI = [
  'function getPair(address, address) external view returns (address)',
  'function createPair(address, address) external returns (address)',
] as const;

// Uniswap V2 Pair ABI
const UNISWAP_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
] as const;

function normalizeHexPrivateKey(envName: string): string {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    throw new Error(`Missing required environment variable: ${envName}`);
  }

  const candidate = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(candidate)) {
    throw new Error(
      `Invalid ${envName}. Expected 32-byte hex string (64 hex chars), with optional 0x prefix.`
    );
  }

  return `0x${candidate}`;
}

function getEnvVar(envName: string): string {
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${envName}`);
  }
  return value;
}

function getEnvVarOptional(envName: string, defaultValue: string): string {
  return process.env[envName]?.trim() || defaultValue;
}

interface DeploymentState {
  ceoToken?: string;
  usdc?: string;
  configuration?: {
    admin?: string;
  };
  uniswapPool?: {
    pairAddress: string;
    ceoAmount: string;
    usdcAmount: string;
    targetPrice: string;
    deployedAt: string;
    transactionHash: string;
    blockNumber: number;
  };
  lastUpdate?: string;
}

async function loadDeploymentState(stateFilePath: string): Promise<DeploymentState> {
  if (!fs.existsSync(stateFilePath)) {
    throw new Error('Deployment state not found. Run previous steps first!');
  }
  return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
}

function saveDeploymentState(stateFilePath: string, state: DeploymentState): void {
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
}

(async function () {
  console.log('\n=== Deploy CEO/USDC Uniswap V2 Pool ===\n');

  // Load deployment state
  const stateFile = path.join(__dirname, '..', 'deployment-state.json');
  let deploymentState: DeploymentState;
  try {
    deploymentState = await loadDeploymentState(stateFile);
  } catch (error: any) {
    console.error('❌', error.message);
    process.exit(1);
  }

  // Verify required contracts are present
  if (!deploymentState.ceoToken) {
    console.error('❌ CEO Token address not found. Check deployment-state.json');
    process.exit(1);
  }
  if (!deploymentState.usdc) {
    console.error('❌ USDC address not found. Check deployment-state.json');
    process.exit(1);
  }
  if (!deploymentState.configuration?.admin) {
    console.error('❌ Approver address not found. Check deployment-state.json');
    process.exit(1);
  }

  const ceoTokenAddress = deploymentState.ceoToken;
  const usdcAddress = deploymentState.usdc;
  const adminAddress = deploymentState.configuration.admin;

  console.log('Configuration:');
  console.log('- CEO Token:', ceoTokenAddress);
  console.log('- USDC Token:', usdcAddress);
  console.log('- Approver (liquidity provider):', adminAddress);

  // Get network configuration
  const network = getEnvVarOptional('BASE_RPC_HTTP_URL', '');
  const networkName = network.includes('base') ? 'base' : 'mainnet';
  const routerAddress = UNISWAP_ROUTERS[networkName];

  if (!routerAddress) {
    console.error(`❌ No Uniswap V2 router configured for network: ${networkName}`);
    process.exit(1);
  }

  console.log('- Network:', networkName);
  console.log('- Uniswap Router:', routerAddress);

  // Get RPC URL and create ethers provider
  const rpcUrl = getEnvVar('BASE_RPC_HTTP_URL');
  const provider = new JsonRpcProvider(rpcUrl);

  // Create ethers wallet signer
  const privateKey = normalizeHexPrivateKey('EVM_PRIVATE_KEY');
  const wallet = new Wallet(privateKey, provider);
  const deployerAddress = wallet.address;

  console.log('Deploying with account:', deployerAddress);
  const balance = await provider.getBalance(deployerAddress);
  console.log('Account balance:', formatEther(balance), 'ETH');

  // Get contract instances using ethers
  const ceoToken = new Contract(ceoTokenAddress, ERC20_ABI, wallet);
  const usdc = new Contract(usdcAddress, ERC20_ABI, wallet);
  const router = new Contract(routerAddress, UNISWAP_ROUTER_ABI, wallet);

  // Get decimals
  const ceoDecimals = await ceoToken.decimals();
  const usdcDecimals = await usdc.decimals();

  console.log('\n--- Checking Approver Balances ---');

  // Check if deployer is the approver
  if (deployerAddress.toLowerCase() !== adminAddress.toLowerCase()) {
    console.error('❌ Error: Current signer must be the approver to provide liquidity!');
    console.error(`   Expected: ${adminAddress}`);
    console.error(`   Got: ${deployerAddress}`);
    process.exit(1);
  }

  const approverCEOBalance = await ceoToken.balanceOf(deployerAddress);
  const approverUSDCBalance = await usdc.balanceOf(deployerAddress);

  console.log('Approver CEO Balance:', formatUnits(approverCEOBalance, ceoDecimals), 'CEO');
  console.log('Approver USDC Balance:', formatUnits(approverUSDCBalance, usdcDecimals), 'USDC');

  if (approverCEOBalance === 0n) {
    console.error('❌ Approver has no CEO tokens! Cannot create liquidity pool.');
    process.exit(1);
  }

  // Calculate amounts for liquidity pool
  // Target price: 1 CEO = 0.000001 USDC (or 1 million CEO = 1 USDC)
  // We'll use 50% of approver's CEO balance
  const ceoLiquidityAmount = approverCEOBalance / 2n;

  // Calculate required USDC based on target price
  // Price = 0.000001 USDC per CEO
  // USDC = ceoLiquidityAmount * 0.000001
  const usdcLiquidityAmount =
    (ceoLiquidityAmount * BigInt(10 ** Number(usdcDecimals))) /
    (BigInt(1000000) * BigInt(10 ** Number(ceoDecimals)));

  console.log('\n--- Liquidity Pool Parameters ---');
  console.log('Target Price: 1 CEO = 0.000001 USDC');
  console.log('CEO Amount (50% of balance):', formatUnits(ceoLiquidityAmount, ceoDecimals), 'CEO');
  console.log('USDC Amount (calculated):', formatUnits(usdcLiquidityAmount, usdcDecimals), 'USDC');

  // Verify approver has enough USDC
  if (approverUSDCBalance < usdcLiquidityAmount) {
    console.error('\n❌ Insufficient USDC balance!');
    console.error(`   Required: ${formatUnits(usdcLiquidityAmount, usdcDecimals)} USDC`);
    console.error(`   Available: ${formatUnits(approverUSDCBalance, usdcDecimals)} USDC`);
    console.error('\n💡 You can:');
    console.error('   1. Mint more USDC (if using mock USDC)');
    console.error('   2. Reduce CEO amount for liquidity');
    console.error('   3. Acquire more USDC');
    process.exit(1);
  }

  // Check if pool already exists and create if needed
  const factoryAddress = await router.factory();
  console.log('Factory Address:', factoryAddress);
  
  // Use provider for view functions (read-only, no signer needed)
  const factoryView = new Contract(factoryAddress, UNISWAP_FACTORY_ABI, provider);
  
  let pairAddress = await factoryView.getPair(ceoTokenAddress, usdcAddress);
  console.log('Pair address:', pairAddress);

  if (pairAddress === ZeroAddress) {
    console.log('\n--- Creating Liquidity Pair ---');
    console.log('No existing pair found. Creating new pair...');

    // Use wallet for write operations (needs signer)
    const factoryWrite = new Contract(factoryAddress, UNISWAP_FACTORY_ABI, wallet);
    const createPairTx = await factoryWrite.createPair(ceoTokenAddress, usdcAddress);
    console.log('⏳ Waiting for pair creation...');
    console.log('Transaction hash:', createPairTx.hash);

    const createReceipt = await createPairTx.wait();
    console.log('✅ Pair created successfully!');
    console.log(`   Block: ${createReceipt.blockNumber}`);
    console.log(`   Gas used: ${createReceipt.gasUsed.toString()}`);

    // Get the pair address after creation (use view contract)
    pairAddress = await factoryView.getPair(ceoTokenAddress, usdcAddress);
    console.log(`   Pair Address: ${pairAddress}`);
  } else {
    console.log('\n⚠️  Warning: Liquidity pool already exists at:', pairAddress);
    console.log('   This script will ADD liquidity to the existing pool');
    console.log('   The price will be determined by existing pool ratios');

    // Get current reserves
    const pair = new Contract(pairAddress, UNISWAP_PAIR_ABI, wallet);

    const token0 = await pair.token0();
    const token1 = await pair.token1();
    const reserves = await pair.getReserves();

    const isCEOToken0 = token0.toLowerCase() === ceoTokenAddress.toLowerCase();
    const ceoReserve = isCEOToken0 ? reserves[0] : reserves[1];
    const usdcReserve = isCEOToken0 ? reserves[1] : reserves[0];

    console.log('\n   Current Pool Reserves:');
    console.log(`   - CEO: ${formatUnits(ceoReserve, ceoDecimals)}`);
    console.log(`   - USDC: ${formatUnits(usdcReserve, usdcDecimals)}`);

    // Only calculate price if reserves exist
    if (ceoReserve > 0n && usdcReserve > 0n) {
      const currentPrice =
        (BigInt(usdcReserve) * BigInt(10 ** Number(ceoDecimals))) / BigInt(ceoReserve);
      console.log(`   - Current Price: 1 CEO = ${formatUnits(currentPrice, usdcDecimals)} USDC\n`);
    } else {
      console.log(`   - Current Price: Pool has no liquidity yet\n`);
    }
  }

  try {
    // Step 1: Approve router to spend tokens
    console.log('\n--- Approving Tokens ---');

    console.log('Approving CEO tokens...');
    const approveCEOTx = await ceoToken.approve(routerAddress, ceoLiquidityAmount);
    await approveCEOTx.wait();
    console.log('✅ CEO tokens approved');

    console.log('Approving USDC tokens...');
    const approveUSDCTx = await usdc.approve(routerAddress, usdcLiquidityAmount);
    await approveUSDCTx.wait();
    console.log('✅ USDC tokens approved');

    // Step 2: Add liquidity
    console.log('\n--- Adding Liquidity to Pool ---');

    // Set minimum amounts (95% of desired to account for slippage)
    const minCEO = (ceoLiquidityAmount * 95n) / 100n;
    const minUSDC = (usdcLiquidityAmount * 95n) / 100n;

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

    console.log('Adding liquidity...');
    console.log(`- CEO Amount: ${formatUnits(ceoLiquidityAmount, ceoDecimals)}`);
    console.log(`- USDC Amount: ${formatUnits(usdcLiquidityAmount, usdcDecimals)}`);
    console.log(`- Min CEO (95%): ${formatUnits(minCEO, ceoDecimals)}`);
    console.log(`- Min USDC (95%): ${formatUnits(minUSDC, usdcDecimals)}`);
    console.log(`- Deadline: ${new Date(deadline * 1000).toISOString()}`);

    const addLiquidityTx = await router.addLiquidity(
      ceoTokenAddress,
      usdcAddress,
      ceoLiquidityAmount,
      usdcLiquidityAmount,
      minCEO,
      minUSDC,
      deployerAddress,
      deadline,
      {
        gasLimit: 500000, // Set explicit gas limit
      }
    );

    console.log('\n⏳ Waiting for transaction confirmation...');
    console.log('Transaction hash:', addLiquidityTx.hash);

    const receipt = await addLiquidityTx.wait();
    console.log('✅ Liquidity added successfully!');
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`   Pair Address: ${pairAddress}`);

    // Get final balances
    const finalCEO = await ceoToken.balanceOf(deployerAddress);
    const finalUSDC = await usdc.balanceOf(deployerAddress);

    console.log('\n--- Final Balances ---');
    console.log('Approver CEO Balance:', formatUnits(finalCEO, ceoDecimals), 'CEO');
    console.log('Approver USDC Balance:', formatUnits(finalUSDC, usdcDecimals), 'USDC');

    // Update deployment state
    deploymentState.uniswapPool = {
      pairAddress: pairAddress,
      ceoAmount: ceoLiquidityAmount.toString(),
      usdcAmount: usdcLiquidityAmount.toString(),
      targetPrice: '0.000001',
      deployedAt: new Date().toISOString(),
      transactionHash: addLiquidityTx.hash,
      blockNumber: receipt.blockNumber,
    };
    deploymentState.lastUpdate = new Date().toISOString();

    saveDeploymentState(stateFile, deploymentState);
    console.log('\n✅ Deployment state updated');

    console.log('\n=== CEO/USDC Pool Deployment Complete ===');
    console.log('Pair Address:', pairAddress);
    console.log('Next: Run step 10 to configure Uniswap in minter contract');
  } catch (error: any) {
    console.error('\n❌ Liquidity deployment failed:', error.message);
    if (error.reason) {
      console.error(`   Reason: ${error.reason}`);
    }
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    throw error;
  }
})().catch((e) => {
  console.error('❌ Deployment failed:', e);
  process.exit(1);
});

