import { configManager, validateConfig, TradingStrategyParams, RuntimeConfig } from './config';
import { GRPCClient, PumpfunTransaction } from './grpc/client';
import { TokenManager } from './token/TokenManager';
import { TradingStrategy } from './strategy/TradingStrategy';
import { TradeRecordManager } from './trade/TradeRecordManager';
import { AnalysisEngine } from './analysis/AnalysisEngine';
import { ApiServer } from './api/ApiServer';
import * as cron from 'node-cron';

class PumpfunTrader {
  private grpcClient: GRPCClient;
  private tokenManager: TokenManager;
  private strategy: TradingStrategy;
  private tradeManager: TradeRecordManager;
  private analysisEngine: AnalysisEngine;
  private apiServer: ApiServer;
  private lastAnalysisTime: number;
  private isOptimizationComplete: boolean = false;
  private cronJob: cron.ScheduledTask | null = null;
  private isTradingActive: boolean = false;
  private isInitialized: boolean = false;
  private sessionStartTime: number = Date.now();
  private detectionTimer: NodeJS.Timeout | null = null;

  constructor() {
    const config = configManager.config;
    this.grpcClient = new GRPCClient(config.grpc);
    this.tokenManager = new TokenManager();
    this.strategy = new TradingStrategy(config.strategy, config.fees);
    this.tradeManager = new TradeRecordManager();
    this.analysisEngine = new AnalysisEngine(config.strategy);
    this.apiServer = new ApiServer(config.api);
    this.lastAnalysisTime = Date.now();

    this.setupConfigListeners();
    this.setupApiListeners();
  }

  private setupConfigListeners(): void {
    configManager.onConfigChanged((data: { type: string; params: any }) => {
      console.log(`Config changed (${data.type}):`, data.params);
      
      if (data.type === 'strategy') {
        this.strategy.updateParams(data.params);
      } else if (data.type === 'fees') {
        this.strategy.updateFees(data.params);
      } else if (data.type === 'runtime') {
        if (data.params.analysisIntervalMinutes !== undefined) {
          this.rescheduleAnalysis();
        }
      }
    });
  }

  private setupApiListeners(): void {
    this.apiServer.on('startTrading', () => {
      console.log('Received start trading request from API');
      this.startTrading();
    });

    this.apiServer.on('stopTrading', () => {
      console.log('Received stop trading request from API');
      this.stopTrading();
    });

    this.apiServer.on('runtimeConfigChanged', (params: Partial<RuntimeConfig>) => {
      if (params.analysisIntervalMinutes !== undefined) {
        this.rescheduleAnalysis();
      }
    });
  }

  public async initialize(): Promise<boolean> {
    console.log('Initializing Pumpfun Simulated Trader...\n');

    if (!validateConfig()) {
      console.error('Configuration validation failed. Please check your .env file.');
      return false;
    }

    const config = configManager.config;

    if (config.api.enabled) {
      await this.apiServer.setTradingComponents(
        this.tradeManager,
        this.strategy,
        this.analysisEngine,
        this.tokenManager
      );
      await this.apiServer.start();
    }

    console.log('Starting new trading session...');
    this.tradeManager.startNewSession(config.strategy);

    console.log('Connecting to gRPC server...');
    try {
      await this.grpcClient.connect();
    } catch (error) {
      console.error('Failed to connect to gRPC server:', error);
      return false;
    }

    this.setupEventListeners();
    this.schedulePeriodicAnalysis();
    this.scheduleDetectionTimeout();

    this.isInitialized = true;
    this.isTradingActive = true;
    this.sessionStartTime = Date.now();
    this.apiServer.setTradingStatus({
      isRunning: true,
      startTime: this.sessionStartTime,
    });

    console.log('\n' + '='.repeat(60));
    console.log('PUMPFUN SIMULATED TRADER STARTED');
    console.log('='.repeat(60));
    console.log('Initial Strategy Parameters:');
    console.log(JSON.stringify(config.strategy, null, 2));
    console.log('\nListening for transactions...');
    console.log('='.repeat(60) + '\n');

    return true;
  }

  private setupEventListeners(): void {
    this.grpcClient.on('transaction', (transaction: PumpfunTransaction) => {
      this.handleTransaction(transaction);
    });

    this.grpcClient.on('error', (error: Error) => {
      console.error('gRPC error:', error.message);
    });

    this.grpcClient.on('streamEnd', () => {
      console.log('gRPC stream ended. Attempting to reconnect...');
      this.reconnect();
    });

    this.strategy.on('buySignal', (signal: any) => {
    });
  }

  private handleTransaction(transaction: PumpfunTransaction): void {
    if (!this.isTradingActive || this.isOptimizationComplete) {
      return;
    }

    const tokenData = this.tokenManager.updateTokenData(transaction);

    if (!tokenData) {
      return;
    }

    const strategyParams = configManager.strategy;

    if (this.strategy.checkBuySignal(tokenData)) {
      const position = this.strategy.openPosition(
        tokenData.mintAddress,
        tokenData.currentPrice,
        strategyParams.positionSize
      );
      this.tradeManager.recordBuy(position);
    }

    const tokensMap = new Map<string, typeof tokenData>();
    for (const token of this.tokenManager.getAllTokens()) {
      tokensMap.set(token.mintAddress, token);
    }

    const sellSignals = this.strategy.checkSellSignals(tokensMap);
    for (const signal of sellSignals) {
      const closedPosition = this.strategy.closePosition(
        signal.positionId,
        signal.price,
        signal.reason,
        signal.isPartial || false,
        signal.sellRatio || 1
      );
      if (closedPosition) {
        this.tradeManager.recordSell(closedPosition);
      }
    }
  }

  private schedulePeriodicAnalysis(): void {
    if (this.cronJob) {
      this.cronJob.stop();
    }

    const config = configManager.config;
    const cronExpression = `*/${config.runtime.analysisIntervalMinutes} * * * *`;

    this.cronJob = cron.schedule(cronExpression, () => {
      this.performPeriodicAnalysis();
    });

    console.log(`Scheduled periodic analysis every ${config.runtime.analysisIntervalMinutes} minutes`);
  }

  private rescheduleAnalysis(): void {
    this.schedulePeriodicAnalysis();
  }

  private scheduleDetectionTimeout(): void {
    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
    }

    const config = configManager.config;
    if (config.runtime.maxDetectionTimeMinutes > 0) {
      this.detectionTimer = setTimeout(() => {
        console.log(`\n[${new Date().toLocaleTimeString()}] Max detection time reached (${config.runtime.maxDetectionTimeMinutes} minutes) elapsed. Stopping trading...`);
        this.stopTrading();
      }, config.runtime.maxDetectionTimeMinutes * 60 * 1000);

      console.log(`Max detection time set to ${config.runtime.maxDetectionTimeMinutes} minutes`);
    }
  }

  private performPeriodicAnalysis(): void {
    if (this.isOptimizationComplete || !this.isTradingActive) {
      return;
    }

    const now = Date.now();
    const analysisStart = this.lastAnalysisTime;
    this.lastAnalysisTime = now;

    console.log(`\n[${new Date().toLocaleTimeString()}] Starting periodic analysis...`);

    const closedPositions = this.strategy.getClosedPositions(analysisStart, now);

    const result = this.analysisEngine.analyzePositions(
      closedPositions,
      analysisStart,
      now
    );

    if (result.isProfitableAfterFees && result.totalTrades > 0) {
      this.completeOptimization(result);
      return;
    }

    if (this.analysisEngine.needsAdjustment(result)) {
      const currentParams = this.strategy.getParams();
      const adjustments = this.analysisEngine.suggestAdjustments(result, currentParams);

      if (adjustments.length > 0) {
        console.log('\nAdjusting strategy parameters...');
        const newParams = this.analysisEngine.applyAdjustments(currentParams, adjustments);
        this.strategy.updateParams(newParams);
        configManager.updateStrategy(newParams);
      } else {
        console.log('No adjustments suggested for this period.');
      }
    }

    this.tokenManager.cleanupOldTokens();
  }

  private completeOptimization(finalResult: any): void {
    this.isOptimizationComplete = true;

    const finalParams = this.strategy.getParams();

    console.log('\n' + '!'.repeat(70));
    console.log('OPTIMIZATION COMPLETE - PROFITABLE PARAMETERS FOUND!');
    console.log('!'.repeat(70));

    this.analysisEngine.printFinalReport(finalParams, finalResult);

    this.tradeManager.endSession(finalParams);

    if (this.cronJob) {
      this.cronJob.stop();
    }

    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
    }

    this.grpcClient.disconnect();

    this.isTradingActive = false;
    this.apiServer.setTradingStatus({
      isRunning: false,
      startTime: undefined,
    });

    console.log('\nSystem will now exit. You can use the optimized parameters for live trading.');
    process.exit(0);
  }

  private async reconnect(): Promise<void> {
    try {
      await this.grpcClient.reconnect();
    } catch (error) {
      console.error('Reconnection failed. Retrying in 5 seconds...');
      setTimeout(() => this.reconnect(), 5000);
    }
  }

  public async startTrading(): Promise<void> {
    if (this.isTradingActive) {
      console.log('Trading is already active');
      return;
    }

    if (!this.isInitialized) {
      await this.initialize();
    } else {
      this.isTradingActive = true;
      this.sessionStartTime = Date.now();
      this.apiServer.setTradingStatus({
        isRunning: true,
        startTime: this.sessionStartTime,
      });

      this.schedulePeriodicAnalysis();
      this.scheduleDetectionTimeout();

      await this.grpcClient.connect();
      await this.grpcClient.subscribeToTransactions();
    }
  }

  public stopTrading(): void {
    if (!this.isTradingActive) {
      console.log('Trading is not active');
      return;
    }

    this.isTradingActive = false;

    if (this.cronJob) {
      this.cronJob.stop();
    }

    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
    }

    this.grpcClient.disconnect();

    const currentParams = this.strategy.getParams();
    this.tradeManager.endSession(currentParams);

    this.apiServer.setTradingStatus({
      isRunning: false,
      startTime: undefined,
    });

    console.log('Pumpfun Trader stopped.');
  }

  public async start(): Promise<void> {
    const config = configManager.config;

    if (config.api.enabled) {
      this.apiServer.setTradingComponents(
        this.tradeManager,
        this.strategy,
        this.analysisEngine,
        this.tokenManager
      );
      await this.apiServer.start();

      console.log('\n' + '='.repeat(60));
      console.log('WEB INTERFACE READY');
      console.log('='.repeat(60));
      console.log(`Open your browser and go to: http://${config.api.host}:${config.api.port}`);
      console.log('='.repeat(60) + '\n');
    }

    const initialized = await this.initialize();
    if (!initialized) {
      process.exit(1);
    }

    await this.grpcClient.subscribeToTransactions();
  }

  public stop(): void {
    this.isTradingActive = false;

    if (this.cronJob) {
      this.cronJob.stop();
    }

    if (this.detectionTimer) {
      clearTimeout(this.detectionTimer);
    }

    this.grpcClient.disconnect();

    const currentParams = this.strategy.getParams();
    this.tradeManager.endSession(currentParams);

    this.apiServer.stop();

    console.log('Pumpfun Trader stopped.');
  }
}

async function main() {
  const trader = new PumpfunTrader();

  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down...');
    trader.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down...');
    trader.stop();
    process.exit(0);
  });

  await trader.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
