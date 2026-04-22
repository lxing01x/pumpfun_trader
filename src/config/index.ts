import dotenv from 'dotenv';
import path from 'path';
import { EventEmitter } from 'events';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface GRPCConfig {
  url: string;
  token: string;
}

export interface FeeConfig {
  buyFeePercent: number;
  sellFeePercent: number;
  enableFees: boolean;
}

export interface ApiConfig {
  enabled: boolean;
  port: number;
  host: string;
}

export interface RuntimeConfig {
  maxDetectionTimeMinutes: number;
  analysisIntervalMinutes: number;
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
  fees: FeeConfig;
  api: ApiConfig;
  runtime: RuntimeConfig;
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

const defaultFees: FeeConfig = {
  buyFeePercent: 1,
  sellFeePercent: 1,
  enableFees: true,
};

const defaultApi: ApiConfig = {
  enabled: true,
  port: 3000,
  host: 'localhost',
};

const defaultRuntime: RuntimeConfig = {
  maxDetectionTimeMinutes: 60,
  analysisIntervalMinutes: 5,
};

class ConfigManager extends EventEmitter {
  private currentConfig: Config;

  constructor() {
    super();
    this.currentConfig = {
      grpc: {
        url: process.env.GRPC_URL || '',
        token: process.env.GRPC_TOKEN || '',
      },
      strategy: { ...defaultStrategy },
      fees: { ...defaultFees },
      api: { ...defaultApi },
      runtime: { ...defaultRuntime },
    };
  }

  get config(): Config {
    return this.deepClone(this.currentConfig);
  }

  get strategy(): TradingStrategyParams {
    return { ...this.currentConfig.strategy };
  }

  get fees(): FeeConfig {
    return { ...this.currentConfig.fees };
  }

  get api(): ApiConfig {
    return { ...this.currentConfig.api };
  }

  get runtime(): RuntimeConfig {
    return { ...this.currentConfig.runtime };
  }

  get grpc(): GRPCConfig {
    return { ...this.currentConfig.grpc };
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  updateStrategy(params: Partial<TradingStrategyParams>): void {
    this.currentConfig.strategy = { ...this.currentConfig.strategy, ...params };
    this.emit('configChanged', { type: 'strategy', params });
    console.log('Strategy config updated:', params);
  }

  updateFees(params: Partial<FeeConfig>): void {
    this.currentConfig.fees = { ...this.currentConfig.fees, ...params };
    this.emit('configChanged', { type: 'fees', params });
    console.log('Fees config updated:', params);
  }

  updateApi(params: Partial<ApiConfig>): void {
    this.currentConfig.api = { ...this.currentConfig.api, ...params };
    this.emit('configChanged', { type: 'api', params });
    console.log('API config updated:', params);
  }

  updateRuntime(params: Partial<RuntimeConfig>): void {
    this.currentConfig.runtime = { ...this.currentConfig.runtime, ...params };
    this.emit('configChanged', { type: 'runtime', params });
    console.log('Runtime config updated:', params);
  }

  updateConfig(config: Partial<Config>): void {
    if (config.strategy) this.updateStrategy(config.strategy);
    if (config.fees) this.updateFees(config.fees);
    if (config.api) this.updateApi(config.api);
    if (config.runtime) this.updateRuntime(config.runtime);
  }

  validate(): boolean {
    if (!this.currentConfig.grpc.url) {
      console.error('GRPC_URL is not configured');
      return false;
    }
    if (!this.currentConfig.grpc.token) {
      console.error('GRPC_TOKEN is not configured');
      return false;
    }
    return true;
  }

  onConfigChanged(callback: (data: { type: string; params: any }) => void): void {
    this.on('configChanged', callback);
  }
}

export const configManager = new ConfigManager();
export const config = configManager.config;
export const validateConfig = () => configManager.validate();

export {
  defaultStrategy,
  defaultFees,
  defaultApi,
  defaultRuntime,
};
