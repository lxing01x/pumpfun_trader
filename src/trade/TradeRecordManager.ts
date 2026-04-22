import * as fs from 'fs';
import * as path from 'path';
import { SimulatedTrade, ClosedPosition, Position } from '../types';
import { TradingStrategyParams } from '../config';

export interface TradeRecord {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  entryTimestamp: number;
  exitTimestamp?: number;
  holdTimeMinutes?: number;
  profitLoss?: number;
  profitLossPercent?: number;
  profitLossAfterFees?: number;
  profitLossPercentAfterFees?: number;
  buyFeeAmount?: number;
  buyFeePercent?: number;
  sellFeeAmount?: number;
  sellFeePercent?: number;
  totalFees?: number;
  exitReason?: string;
  status: 'open' | 'closed';
}

export interface SessionStatistics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfitLoss: number;
  totalProfitLossPercent: number;
  totalProfitLossAfterFees: number;
  totalProfitLossPercentAfterFees: number;
  totalFees: number;
  profitFactor: number;
  averageProfit: number;
  averageLoss: number;
  averageHoldTimeMinutes: number;
}

export interface TradingSession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  initialParams: TradingStrategyParams;
  finalParams?: TradingStrategyParams;
  isProfitable: boolean;
  totalProfitLoss: number;
  statistics?: SessionStatistics;
  trades: TradeRecord[];
}

export class TradeRecordManager {
  private dataDir: string;
  private currentSession: TradingSession | null = null;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(process.cwd(), 'data');
    this.ensureDataDirectory();
  }

  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  public startNewSession(params: TradingStrategyParams): TradingSession {
    const sessionId = `session_${Date.now()}`;
    
    this.currentSession = {
      sessionId,
      startTime: Date.now(),
      initialParams: { ...params },
      isProfitable: false,
      totalProfitLoss: 0,
      trades: [],
    };

    console.log(`Started new trading session: ${sessionId}`);
    return this.currentSession;
  }

  public recordBuy(position: Position): void {
    if (!this.currentSession) {
      console.warn('No active session, cannot record buy');
      return;
    }

    const tradeRecord: TradeRecord = {
      id: position.id,
      tokenMint: position.tokenMint,
      tokenSymbol: position.tokenSymbol,
      entryPrice: position.entryPrice,
      amount: position.amount,
      entryTimestamp: position.entryTimestamp,
      buyFeeAmount: position.buyFeeAmount,
      buyFeePercent: position.buyFeePercent,
      status: 'open',
    };

    this.currentSession.trades.push(tradeRecord);
    
    console.log(`Recorded BUY: ${position.tokenMint} at ${position.entryPrice.toExponential(4)}`);
    
    this.saveCurrentSession();
  }

  public recordSell(closedPosition: ClosedPosition): void {
    if (!this.currentSession) {
      console.warn('No active session, cannot record sell');
      return;
    }

    const existingTrade = this.currentSession.trades.find(t => t.id === closedPosition.id);
    
    if (existingTrade) {
      existingTrade.exitPrice = closedPosition.exitPrice;
      existingTrade.exitTimestamp = closedPosition.exitTimestamp;
      existingTrade.holdTimeMinutes = closedPosition.holdTimeMinutes;
      existingTrade.profitLoss = closedPosition.profitLoss;
      existingTrade.profitLossPercent = closedPosition.profitLossPercent;
      existingTrade.profitLossAfterFees = closedPosition.profitLossAfterFees;
      existingTrade.profitLossPercentAfterFees = closedPosition.profitLossPercentAfterFees;
      existingTrade.buyFeeAmount = closedPosition.buyFeeAmount;
      existingTrade.buyFeePercent = closedPosition.buyFeePercent;
      existingTrade.sellFeeAmount = closedPosition.sellFeeAmount;
      existingTrade.sellFeePercent = closedPosition.sellFeePercent;
      existingTrade.totalFees = closedPosition.totalFees;
      existingTrade.exitReason = closedPosition.exitReason;
      existingTrade.status = 'closed';
    } else {
      this.currentSession.trades.push({
        id: closedPosition.id,
        tokenMint: closedPosition.tokenMint,
        tokenSymbol: closedPosition.tokenSymbol,
        entryPrice: closedPosition.entryPrice,
        exitPrice: closedPosition.exitPrice,
        amount: closedPosition.amount,
        entryTimestamp: closedPosition.entryTimestamp,
        exitTimestamp: closedPosition.exitTimestamp,
        holdTimeMinutes: closedPosition.holdTimeMinutes,
        profitLoss: closedPosition.profitLoss,
        profitLossPercent: closedPosition.profitLossPercent,
        profitLossAfterFees: closedPosition.profitLossAfterFees,
        profitLossPercentAfterFees: closedPosition.profitLossPercentAfterFees,
        buyFeeAmount: closedPosition.buyFeeAmount,
        buyFeePercent: closedPosition.buyFeePercent,
        sellFeeAmount: closedPosition.sellFeeAmount,
        sellFeePercent: closedPosition.sellFeePercent,
        totalFees: closedPosition.totalFees,
        exitReason: closedPosition.exitReason,
        status: 'closed',
      });
    }

    this.updateSessionMetrics();
    
    console.log(
      `Recorded SELL: ${closedPosition.tokenMint} at ${closedPosition.exitPrice.toExponential(4)}, ` +
      `P/L After Fees: ${closedPosition.profitLossPercentAfterFees >= 0 ? '+' : ''}${closedPosition.profitLossPercentAfterFees.toFixed(2)}%, Reason: ${closedPosition.exitReason}`
    );
    
    this.saveCurrentSession();
  }

  private saveCurrentSession(): void {
    if (!this.currentSession) return;
    
    const filePath = path.join(this.dataDir, `${this.currentSession.sessionId}.json`);
    
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify(this.currentSession, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('Failed to save session in real-time:', error);
    }
  }

  private updateSessionMetrics(): void {
    if (!this.currentSession) return;

    const closedTrades = this.currentSession.trades.filter(t => t.status === 'closed');
    const totalTrades = closedTrades.length;

    if (totalTrades === 0) {
      this.currentSession.totalProfitLoss = 0;
      this.currentSession.isProfitable = false;
      this.currentSession.statistics = {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalProfitLoss: 0,
        totalProfitLossPercent: 0,
        totalProfitLossAfterFees: 0,
        totalProfitLossPercentAfterFees: 0,
        totalFees: 0,
        profitFactor: 0,
        averageProfit: 0,
        averageLoss: 0,
        averageHoldTimeMinutes: 0,
      };
      return;
    }

    const winningTrades = closedTrades.filter(t => (t.profitLossAfterFees || t.profitLoss || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.profitLossAfterFees || t.profitLoss || 0) <= 0);

    const totalProfitLoss = closedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    const totalProfitLossPercent = closedTrades.length > 0 
      ? closedTrades.reduce((sum, t) => sum + (t.profitLossPercent || 0), 0) / closedTrades.length 
      : 0;

    const totalProfitLossAfterFees = closedTrades.reduce((sum, t) => sum + (t.profitLossAfterFees || t.profitLoss || 0), 0);
    const totalProfitLossPercentAfterFees = closedTrades.length > 0 
      ? closedTrades.reduce((sum, t) => sum + (t.profitLossPercentAfterFees || t.profitLossPercent || 0), 0) / closedTrades.length 
      : 0;

    const totalFees = closedTrades.reduce((sum, t) => sum + (t.totalFees || 0), 0);

    const totalGrossProfit = winningTrades.reduce((sum, t) => sum + Math.max(t.profitLossAfterFees || t.profitLoss || 0, 0), 0);
    const totalGrossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + Math.min(t.profitLossAfterFees || t.profitLoss || 0, 0), 0));
    
    const profitFactor = totalGrossLoss > 0 ? totalGrossProfit / totalGrossLoss : totalGrossProfit > 0 ? Infinity : 0;

    const averageProfit = winningTrades.length > 0 
      ? winningTrades.reduce((sum, t) => sum + (t.profitLossAfterFees || t.profitLoss || 0), 0) / winningTrades.length 
      : 0;
    const averageLoss = losingTrades.length > 0 
      ? losingTrades.reduce((sum, t) => sum + (t.profitLossAfterFees || t.profitLoss || 0), 0) / losingTrades.length 
      : 0;

    const averageHoldTimeMinutes = closedTrades.length > 0 
      ? closedTrades.reduce((sum, t) => sum + (t.holdTimeMinutes || 0), 0) / closedTrades.length 
      : 0;

    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

    this.currentSession.totalProfitLoss = totalProfitLossAfterFees;
    this.currentSession.isProfitable = totalProfitLossAfterFees > 0;
    
    this.currentSession.statistics = {
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalProfitLoss,
      totalProfitLossPercent,
      totalProfitLossAfterFees,
      totalProfitLossPercentAfterFees,
      totalFees,
      profitFactor,
      averageProfit,
      averageLoss,
      averageHoldTimeMinutes,
    };

    console.log('\n' + '='.repeat(60));
    console.log('SESSION STATISTICS UPDATED');
    console.log('='.repeat(60));
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Winning: ${winningTrades.length}, Losing: ${losingTrades.length}`);
    console.log(`Win Rate: ${winRate.toFixed(2)}%`);
    console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log(`Total P/L Before Fees: ${totalProfitLoss >= 0 ? '+' : ''}${totalProfitLoss.toFixed(6)} SOL (${totalProfitLossPercent.toFixed(2)}%)`);
    console.log(`Total P/L After Fees: ${totalProfitLossAfterFees >= 0 ? '+' : ''}${totalProfitLossAfterFees.toFixed(6)} SOL (${totalProfitLossPercentAfterFees.toFixed(2)}%)`);
    console.log(`Total Fees Paid: ${totalFees.toFixed(6)} SOL`);
    console.log(`Avg Profit: ${averageProfit.toFixed(6)} SOL | Avg Loss: ${averageLoss.toFixed(6)} SOL`);
    console.log(`Avg Hold Time: ${averageHoldTimeMinutes.toFixed(2)} min`);
    console.log('='.repeat(60) + '\n');
  }

  public endSession(finalParams?: TradingStrategyParams): TradingSession | null {
    if (!this.currentSession) return null;

    this.currentSession.endTime = Date.now();
    if (finalParams) {
      this.currentSession.finalParams = { ...finalParams };
    }
    this.updateSessionMetrics();

    const sessionToSave = { ...this.currentSession };
    this.saveSession(sessionToSave);
    
    console.log(
      `Ended session ${sessionToSave.sessionId}. ` +
      `Total P/L: ${sessionToSave.totalProfitLoss.toFixed(4)}`
    );

    this.currentSession = null;
    return sessionToSave;
  }

  public saveSession(session: TradingSession): void {
    const filePath = path.join(this.dataDir, `${session.sessionId}.json`);
    
    try {
      fs.writeFileSync(
        filePath,
        JSON.stringify(session, null, 2),
        'utf8'
      );
      console.log(`Session saved to: ${filePath}`);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  public loadSession(sessionId: string): TradingSession | null {
    const filePath = path.join(this.dataDir, `${sessionId}.json`);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`Session file not found: ${filePath}`);
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content) as TradingSession;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  }

  public getCurrentSession(): TradingSession | null {
    return this.currentSession;
  }

  public listSessions(): string[] {
    if (!fs.existsSync(this.dataDir)) return [];
    
    const files = fs.readdirSync(this.dataDir)
      .filter(f => f.startsWith('session_') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    return files;
  }

  public getLatestSession(): TradingSession | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) return null;
    
    const latestSessionId = sessions[0].replace('.json', '');
    return this.loadSession(latestSessionId);
  }

  public exportSessionToCSV(sessionId: string): string {
    const session = this.loadSession(sessionId);
    if (!session) return '';

    const headers = [
      'Trade ID',
      'Token Symbol',
      'Entry Price',
      'Exit Price',
      'Amount',
      'Entry Time',
      'Exit Time',
      'Hold Time (min)',
      'P/L',
      'P/L (%)',
      'Exit Reason',
      'Status',
    ].join(',');

    const rows = session.trades.map(trade => [
      trade.id,
      trade.tokenSymbol,
      trade.entryPrice.toFixed(10),
      trade.exitPrice?.toFixed(10) || '',
      trade.amount.toFixed(0),
      new Date(trade.entryTimestamp).toISOString(),
      trade.exitTimestamp ? new Date(trade.exitTimestamp).toISOString() : '',
      trade.holdTimeMinutes?.toFixed(2) || '',
      trade.profitLoss?.toFixed(6) || '',
      trade.profitLossPercent?.toFixed(2) || '',
      trade.exitReason || '',
      trade.status,
    ].join(','));

    return [headers, ...rows].join('\n');
  }
}
