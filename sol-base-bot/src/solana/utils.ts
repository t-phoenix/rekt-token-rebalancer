import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Creates a Solana connection
 */
export function createConnection(solana_rpc:string): Connection {
  return new Connection(solana_rpc, 'confirmed');
}


export function getKeyPairFromPrivateKey(key: string) {
  return Keypair.fromSecretKey(new Uint8Array(bs58.decode(key)));
}

