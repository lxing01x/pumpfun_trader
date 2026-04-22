import { ClosedPosition, AnalysisResult, StrategyAdjustment } from '../types';
import { TradingStrategyParams } from '../config';

export interface ParameterTuningState {
  currentParams: TradingStrategyParams;
  bestParams: TradingStrategyParams | null;
  bestProfit: number;
  adjustmentCount: number;
  history: { params: TradingStrategyParams; result: AnalysisResult }[];
}

export class AnalysisEngine {
  private tuningState: ParameterTuningState;

  constructor(initialParams: TradingStrategyParams) {
    this.tuningState = {
      currentParams: { ...initialParams },
      bestParams: null,
      bestProfit: -Infinity,
      adjustmentCount: 0,
      history: [],
    };
  }

  public analyzePositions(
    closedPositions: ClosedPosition[],
    periodStart: number,
    periodEnd: number
  ): AnalysisResult {
    const relevantPositions = closedPositions.filter(
      p => p.exitTimestamp >= periodStart && p.exitTimestamp <= periodEnd
    );

    if (relevantPositions.length === 0) {
      return {
        periodStart,
        periodEnd,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalProfitLoss: 0,
        totalProfitLossPercent: 0,
        averageHoldTimeMinutes: 0,
        isProfitable: false,
      };
    }

    const winningTrades = relevantPositions.filter(p => p.profitLoss > 0);
    const losingTrades = relevantPositions.filter(p => p.profitLoss <= 0);

    const totalProfitLoss = relevantPositions.reduce((sum, p) => sum + p.profitLoss, 0);
    const totalProfitLossPercent = 
      relevantPositions.length > 0 
        ? relevantPositions.reduce((sum, p) => sum + p.profitLossPercent, 0) / relevantPositions.length 
        : 0;

    const averageHoldTimeMinutes = 
      relevantPositions.length > 0 
        ? relevantPositions.reduce((sum, p) => sum + p.holdTimeMinutes, 0) / relevantPositions.length 
        : 0;

    const result: AnalysisResult = {
      periodStart,
      periodEnd,
      totalTrades: relevantPositions.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: relevantPositions.length > 0 ? (winningTrades.length / relevantPositions.length) * 100 : 0,
      totalProfitLoss,
      totalProfitLossPercent,
      averageHoldTimeMinutes,
      isProfitable: totalProfitLoss > 0,
    };

    console.log('\n' + '='.repeat(60));
    console.log('ANALYSIS RESULT');
    console.log('='.repeat(60));
    console.log(`Period: ${new Date(periodStart).toLocaleTimeString()} - ${new Date(periodEnd).toLocaleTimeString()}`);
    console.log(`Total Trades: ${result.totalTrades}`);
    console.log(`Winning: ${result.winningTrades}, Losing: ${result.losingTrades}`);
    console.log(`Win Rate: ${result.winRate.toFixed(2)}%`);
    console.log(`Total P/L: ${result.totalProfitLoss.toFixed(6)} SOL (${result.totalProfitLossPercent.toFixed(2)}%)`);
    console.log(`Avg Hold Time: ${result.averageHoldTimeMinutes.toFixed(2)} min`);
    console.log(`Status: ${result.isProfitable ? 'PROFITABLE' : 'LOSING'}`);
    console.log('='.repeat(60) + '\n');

    return result;
  }

  public needsAdjustment(result: AnalysisResult): boolean {
    if (result.totalTrades === 0) {
      console.log('No trades in period, considering parameter adjustment...');
      return true;
    }
    return !result.isProfitable;
  }

  public suggestAdjustments(
    result: AnalysisResult,
    currentParams: TradingStrategyParams
  ): StrategyAdjustment[] {
    const adjustments: StrategyAdjustment[] = [];

    if (result.totalTrades === 0) {
      adjustments.push({
        parameter: 'minVolume',
        oldValue: currentParams.minVolume,
        newValue: Math.max(currentParams.minVolume * 0.7, 1000),
        reason: 'No trades - lowering volume threshold to capture more opportunities',
      });
      
      adjustments.push({
        parameter: 'minPriceChangePercent',
        oldValue: currentParams.minPriceChangePercent,
        newValue: Math.max(currentParams.minPriceChangePercent * 0.8, 2),
        reason: 'No trades - lowering price change threshold',
      });
      
      return adjustments;
    }

    const winningTrades = result.winningTrades;
    const losingTrades = result.losingTrades;

    if (result.winRate < 40) {
      adjustments.push({
        parameter: 'minPriceChangePercent',
        oldValue: currentParams.minPriceChangePercent,
        newValue: Math.min(currentParams.minPriceChangePercent * 1.2, 15),
        reason: 'Low win rate - increasing minimum price change for stronger momentum',
      });

      adjustments.push({
        parameter: 'minVolume',
        oldValue: currentParams.minVolume,
        newValue: Math.min(currentParams.minVolume * 1.3, 50000),
        reason: 'Low win rate - increasing volume requirement for liquidity',
      });
    }

    if (losingTrades > 0 && result.winRate < 50) {
      adjustments.push({
        parameter: 'stopLossPercent',
        oldValue: currentParams.stopLossPercent,
        newValue: Math.max(currentParams.stopLossPercent * 0.9, 1),
        reason: 'Tightening stop loss to limit losses',
      });
    }

    if (winningTrades > 0 && result.totalProfitLoss < 0) {
      adjustments.push({
        parameter: 'takeProfitPercent',
        oldValue: currentParams.takeProfitPercent,
        newValue: Math.min(currentParams.takeProfitPercent * 0.9, 20),
        reason: 'Adjusting take profit to lock in gains earlier',
      });
    }

    if (result.averageHoldTimeMinutes > currentParams.maxHoldTimeMinutes * 0.8) {
      adjustments.push({
        parameter: 'maxHoldTimeMinutes',
        oldValue: currentParams.maxHoldTimeMinutes,
        newValue: Math.min(currentParams.maxHoldTimeMinutes * 1.2, 120),
        reason: 'Positions hitting time limit - extending max hold time',
      });
    }

    if (result.winRate >= 50 && result.totalProfitLossPercent < 2) {
      adjustments.push({
        parameter: 'takeProfitPercent',
        oldValue: currentParams.takeProfitPercent,
        newValue: Math.min(currentParams.takeProfitPercent * 1.1, 25),
        reason: 'Good win rate but low profit - increasing take profit target',
      });
    }

    return adjustments;
  }

  public applyAdjustments(
    params: TradingStrategyParams,
    adjustments: StrategyAdjustment[]
  ): TradingStrategyParams {
    const newParams = { ...params };

    for (const adj of adjustments) {
      (newParams as any)[adj.parameter] = adj.newValue;
      console.log(`Adjusted ${adj.parameter}: ${adj.oldValue.toFixed(2)} -> ${adj.newValue.toFixed(2)}`);
      console.log(`  Reason: ${adj.reason}`);
    }

    this.tuningState.history.push({
      params: { ...newParams },
      result: {} as AnalysisResult,
    });
    this.tuningState.adjustmentCount++;
    this.tuningState.currentParams = { ...newParams };

    return newParams;
  }

  public updateBestParams(params: TradingStrategyParams, result: AnalysisResult): void {
    if (result.totalProfitLoss > this.tuningState.bestProfit) {
      this.tuningState.bestProfit = result.totalProfitLoss;
      this.tuningState.bestParams = { ...params };
      console.log(`New best parameters found with P/L: ${result.totalProfitLoss.toFixed(6)}`);
    }
  }

  public getBestParams(): TradingStrategyParams | null {
    return this.tuningState.bestParams;
  }

  public getTuningState(): ParameterTuningState {
    return { ...this.tuningState };
  }

  public printFinalReport(finalParams: TradingStrategyParams, finalResult: AnalysisResult): void {
    console.log('\n' + '#'.repeat(70));
    console.log('FINAL OPTIMIZATION REPORT');
    console.log('#'.repeat(70));
    
    console.log('\nStatus: PROFITABLE PARAMETERS FOUND!');
    console.log(`Total Adjustments: ${this.tuningState.adjustmentCount}`);
    
    console.log('\nFinal Parameters:');
    console.log(JSON.stringify(finalParams, null, 2));
    
    console.log('\nFinal Performance:');
    console.log(`  Win Rate: ${finalResult.winRate.toFixed(2)}%`);
    console.log(`  Total Trades: ${finalResult.totalTrades}`);
    console.log(`  Total P/L: ${finalResult.totalProfitLoss.toFixed(6)} SOL`);
    console.log(`  Avg P/L %: ${finalResult.totalProfitLossPercent.toFixed(2)}%`);
    
    console.log('\nRecommended Parameters for Live Trading:');
    console.log(JSON.stringify(finalParams, null, 2));
    console.log('#'.repeat(70) + '\n');
  }
}
