import { config, validateConfig, TradingStrategyParams } from './config';
import { GRPCClient, PumpfunTransaction } from './grpc/client';
import { TokenManager } from './token/TokenManager';
import { TradingStrategy } from './strategy/TradingStrategy';
import { TradeRecordManager } from './trade/TradeRecordManager';
import { AnalysisEngine } from './analysis/AnalysisEngine';
import * as cron from 'node-cron';

class PumpfunTrader {
  private grpcClient: GRPCClient;
  private tokenManager: TokenManager;
  private strategy: TradingStrategy;
  private tradeManager: TradeRecordManager;
  private analysisEngine: AnalysisEngine;
  private lastAnalysisTime: number;
  private isOptimizationComplete: boolean = false;
  private cronJob: cron.ScheduledTask | null = null;

  constructor() {
    this.grpcClient = new GRPCClient(config.grpc);
    this.tokenManager = new TokenManager();
    this.strategy = new TradingStrategy(config.strategy);
    this.tradeManager = new TradeRecordManager();
    this.analysisEngine = new AnalysisEngine(config.strategy);
    this.lastAnalysisTime = Date.now();
  }

  public async initialize(): Promise<boolean> {
    console.log('Initializing Pumpfun Simulated Trader...\n');

    if (!validateConfig()) {
      console.error('Configuration validation failed. Please check your .env file.');
      return false;
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
    if (this.isOptimizationComplete) {
      return;
    }

    const tokenData = this.tokenManager.updateTokenData(transaction);

    if (this.strategy.checkBuySignal(tokenData)) {
      const position = this.strategy.openPosition(
        tokenData.mintAddress,
        tokenData.currentPrice,
        config.strategy.positionSize
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
        signal.reason
      );
      if (closedPosition) {
        this.tradeManager.recordSell(closedPosition);
      }
    }
  }

  private schedulePeriodicAnalysis(): void {
    const cronExpression = `*/${config.analysisIntervalMinutes} * * * *`;
    
    this.cronJob = cron.schedule(cronExpression, () => {
      this.performPeriodicAnalysis();
    });

    console.log(`Scheduled periodic analysis every ${config.analysisIntervalMinutes} minutes`);
  }

  private performPeriodicAnalysis(): void {
    if (this.isOptimizationComplete) {
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

    if (result.isProfitable && result.totalTrades > 0) {
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

    this.grpcClient.disconnect();

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

  public async start(): Promise<void> {
    const initialized = await this.initialize();
    if (!initialized) {
      process.exit(1);
    }

    await this.grpcClient.subscribeToTransactions();
  }

  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
    }
    this.grpcClient.disconnect();
    
    const currentParams = this.strategy.getParams();
    this.tradeManager.endSession(currentParams);
    
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
