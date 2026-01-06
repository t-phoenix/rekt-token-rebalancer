import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  RUN_MODE: z.enum(['paper', 'live']).default('paper'),
  ENABLE_LIVE_TRADING: z.coerce.boolean().default(false),

  TOKEN_KEY: z.string().min(1),

  PRICE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),

  MIN_PROFIT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.02),
  TRADE_SIZE_USD: z.coerce.number().positive().default(100),
  MIN_LIQUIDITY_USD: z.coerce.number().min(0).default(0),

  SOLANA_RPC_HTTP_URL: z.string().url(),
  SOLANA_PRIVATE_KEY: z.string().default(''),
  SOLANA_TOKEN_MINT: z.string().default(''),
  SOLANA_TOKEN_MINTS: z.string().default(''),
  SOLANA_PRICE_SOURCE: z.enum(['mock', 'pumpfun']).default('mock'),
  SOLANA_TOKEN_PRICE_USD: z.coerce.number().positive().default(0.01),
  SOLANA_SOL_PRICE_USD: z.coerce.number().positive().default(200),
  SOLANA_SWAP_SLIPPAGE_DECIMAL: z.coerce.number().min(0).max(5).default(0.25),
  SOLANA_PRIORITY_FEE_SOL: z.coerce.number().min(0).default(0),

  BASE_RPC_HTTP_URL: z.string().url(),
  BASE_CHAIN_ID: z.coerce.number().int().positive().default(8453),
  BASE_PRIVATE_KEY_HEX: z.string().default(''),
  BASE_TOKEN_ADDRESS: z.string().default(''),
  BASE_USDC_ADDRESS: z.string().default(''),
  BASE_PRICE_SOURCE: z.enum(['mock', 'uniswap-v2-router02']).default('mock'),
  BASE_TOKEN_PRICE_USD: z.coerce.number().positive().default(0.01),

  UNISWAP_V2_ROUTER02_ADDRESS: z.string().default(''),
  BASE_SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(10_000).default(50),
  BASE_SWAP_DEADLINE_SECONDS: z.coerce.number().int().positive().default(30),

  COINMARKETCAP_API_KEY: z.string().default(''),

  // Event Monitoring Configuration
  PRICE_MOVEMENT_THRESHOLD: z.coerce.number().min(0).max(100).default(2.0),
  AUTO_EXECUTE_TRADES: z.coerce.boolean().default(true),
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  ANALYSIS_COOLDOWN_MS: z.coerce.number().int().min(0).default(5000),
  EVENT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  LOG_ALL_EVENTS: z.coerce.boolean().default(false),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i: z.ZodIssue) => `${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${message}`);
  }

  return parsed.data;
}
