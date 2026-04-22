import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface GRPCConfig {
  url: string;
  token: string;
}

export interface TradingStrategyParams {
  minVolume: number;
  minPriceChangePercent: number;
  maxPriceChangePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxHoldTimeMinutes: number;
  positionSize: number;
}

export interface Config {
  grpc: GRPCConfig;
  strategy: TradingStrategyParams;
  analysisIntervalMinutes: number;
}

const defaultStrategy: TradingStrategyParams = {
  minVolume: 5,
  minPriceChangePercent: 3,
  maxPriceChangePercent: 50,
  stopLossPercent: 2,
  takeProfitPercent: 5,
  maxHoldTimeMinutes: 5,
  positionSize: 1,
};

export const config: Config = {
  grpc: {
    url: process.env.GRPC_URL || '',
    token: process.env.GRPC_TOKEN || '',
  },
  strategy: defaultStrategy,
  analysisIntervalMinutes: 10,
};

export function validateConfig(): boolean {
  if (!config.grpc.url) {
    console.error('GRPC_URL is not configured');
    return false;
  }
  if (!config.grpc.token) {
    console.error('GRPC_TOKEN is not configured');
    return false;
  }
  return true;
}
