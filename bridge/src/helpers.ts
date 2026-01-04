import {
  ChainAddress,
  ChainContext,
  Network,
  Signer,
  Wormhole,
  Chain,
  TokenId,
  isTokenId,
} from '@wormhole-foundation/sdk';
import evm from '@wormhole-foundation/sdk/evm';
import solana from '@wormhole-foundation/sdk/solana';
import sui from '@wormhole-foundation/sdk/sui';
import aptos from '@wormhole-foundation/sdk/aptos';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '..', '.env') });

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

export interface SignerStuff<N extends Network, C extends Chain> {
  chain: ChainContext<N, C>;
  signer: Signer<N, C>;
  address: ChainAddress<C>;
}

// Signer setup function for different blockchain platforms
export async function getSigner<N extends Network, C extends Chain>(
  chain: ChainContext<N, C>,
  gasLimit?: bigint
): Promise<{
  chain: ChainContext<N, C>;
  signer: Signer<N, C>;
  address: ChainAddress<C>;
}> {
  let signer: Signer;
  const platform = chain.platform.utils()._platform;

  switch (platform) {
    case 'Solana':
      signer = await (
        await solana()
      ).getSigner(await chain.getRpc(), getEnvVar('SOL_PRIVATE_KEY'));
      break;
    case 'Evm':
      const evmSignerOptions = gasLimit ? { gasLimit } : {};
      signer = await (
        await evm()
      ).getSigner(
        await chain.getRpc(),
        normalizeHexPrivateKey('EVM_PRIVATE_KEY'),
        evmSignerOptions
      );
      break;
    case 'Sui':
      signer = await (
        await sui()
      ).getSigner(await chain.getRpc(), getEnvVar('SUI_MNEMONIC'));
      break;
    case 'Aptos':
      signer = await (
        await aptos()
      ).getSigner(await chain.getRpc(), getEnvVar('APTOS_PRIVATE_KEY'));
      break;
    default:
      throw new Error('Unsupported platform: ' + platform);
  }

  return {
    chain,
    signer: signer as Signer<N, C>,
    address: Wormhole.chainAddress(chain.chain, signer.address()),
  };
}

export async function getTokenDecimals<
  N extends 'Mainnet' | 'Testnet' | 'Devnet'
>(
  wh: Wormhole<N>,
  token: TokenId,
  sendChain: ChainContext<N, any>
): Promise<number> {
  return isTokenId(token)
    ? Number(await wh.getDecimals(token.chain, token.address))
    : sendChain.config.nativeTokenDecimals;
}