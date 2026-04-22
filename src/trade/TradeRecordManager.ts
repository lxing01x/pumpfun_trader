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
  exitReason?: string;
  status: 'open' | 'closed';
}

export interface TradingSession {
  sessionId: string;
  startTime: number;
  endTime?: number;
  initialParams: TradingStrategyParams;
  finalParams?: TradingStrategyParams;
  isProfitable: boolean;
  totalProfitLoss: number;
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
      status: 'open',
    };

    this.currentSession.trades.push(tradeRecord);
    
    const shortMint = position.tokenMint.length > 8 
      ? `${position.tokenMint.substring(0, 4)}...${position.tokenMint.substring(position.tokenMint.length - 4)}` 
      : position.tokenMint;
    console.log(`Recorded BUY: ${shortMint} at ${position.entryPrice.toExponential(4)}`);
    
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
        exitReason: closedPosition.exitReason,
        status: 'closed',
      });
    }

    this.updateSessionMetrics();
    
    const shortMint = closedPosition.tokenMint.length > 8 
      ? `${closedPosition.tokenMint.substring(0, 4)}...${closedPosition.tokenMint.substring(closedPosition.tokenMint.length - 4)}` 
      : closedPosition.tokenMint;
    console.log(
      `Recorded SELL: ${shortMint} at ${closedPosition.exitPrice.toExponential(4)}, ` +
      `P/L: ${closedPosition.profitLossPercent.toFixed(2)}%, Reason: ${closedPosition.exitReason}`
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
    const totalProfitLoss = closedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    
    this.currentSession.totalProfitLoss = totalProfitLoss;
    this.currentSession.isProfitable = totalProfitLoss > 0;
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
