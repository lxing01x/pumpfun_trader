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
  minVolume: 10000,
  minPriceChangePercent: 5,
  maxPriceChangePercent: 50,
  stopLossPercent: 3,
  takeProfitPercent: 10,
  maxHoldTimeMinutes: 60,
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
