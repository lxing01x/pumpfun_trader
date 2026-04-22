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
  minTradeCount5s: number;
  minPriceChange5sPercent: number;
  maxDropFromHighestPercent: number;
  minBuySellRatio: number;
  minBuySellCountRatio: number;
  minVolumeTrendRatio: number;
  maxVolatility30s: number;
  sharpDropThresholdPercent: number;
  gradualDropThresholdPercent: number;
  crashThresholdPercent: number;
  pumpThresholdPercent: number;
  minTradeFrequency1m: number;
  minSolAmountFilter: number;
  enableRealTimeSave: boolean;
  trailingStopPercent: number;
  enableTrailingStop: boolean;
  partialTakeProfitPercent: number;
  enablePartialTakeProfit: boolean;
  partialSellRatio: number;
  crashStopMultiplier: number;
  pumpSellDelayMs: number;
}

export interface Config {
  grpc: GRPCConfig;
  strategy: TradingStrategyParams;
  analysisIntervalMinutes: number;
}

const defaultStrategy: TradingStrategyParams = {
  minVolume: 2,
  minPriceChangePercent: 2,
  maxPriceChangePercent: 30,
  stopLossPercent: 1.5,
  takeProfitPercent: 4,
  maxHoldTimeMinutes: 3,
  positionSize: 0.5,
  minTradeCount5s: 3,
  minPriceChange5sPercent: 1,
  maxDropFromHighestPercent: 15,
  minBuySellRatio: 1.5,
  minBuySellCountRatio: 1.2,
  minVolumeTrendRatio: 1.2,
  maxVolatility30s: 15,
  sharpDropThresholdPercent: 15,
  gradualDropThresholdPercent: 5,
  crashThresholdPercent: 20,
  pumpThresholdPercent: 20,
  minTradeFrequency1m: 5,
  minSolAmountFilter: 0.01,
  enableRealTimeSave: true,
  trailingStopPercent: 1,
  enableTrailingStop: true,
  partialTakeProfitPercent: 2,
  enablePartialTakeProfit: true,
  partialSellRatio: 0.5,
  crashStopMultiplier: 0.5,
  pumpSellDelayMs: 2000,
};

export const config: Config = {
  grpc: {
    url: process.env.GRPC_URL || '',
    token: process.env.GRPC_TOKEN || '',
  },
  strategy: defaultStrategy,
  analysisIntervalMinutes: 5,
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
