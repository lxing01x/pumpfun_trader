export interface TokenData {
  mintAddress: string;
  symbol: string;
  name: string;
  currentPrice: number;
  lastPrice: number;
  volume24h: number;
  volume10m: number;
  priceChangePercent1m: number;
  priceChangePercent5m: number;
  priceChangePercent10m: number;
  lastUpdate: number;
  trades: TokenTrade[];
}

export interface TokenTrade {
  transactionId: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  solAmount: number;
  timestamp: number;
  trader: string;
}

export interface SimulatedTrade {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  timestamp: number;
  relatedTradeId?: string;
}

export interface Position {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  entryPrice: number;
  amount: number;
  entryTimestamp: number;
  currentPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
}

export interface ClosedPosition {
  id: string;
  tokenMint: string;
  tokenSymbol: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  entryTimestamp: number;
  exitTimestamp: number;
  holdTimeMinutes: number;
  profitLoss: number;
  profitLossPercent: number;
  exitReason: 'take_profit' | 'stop_loss' | 'time_limit' | 'manual';
}

export interface AnalysisResult {
  periodStart: number;
  periodEnd: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfitLoss: number;
  totalProfitLossPercent: number;
  averageHoldTimeMinutes: number;
  isProfitable: boolean;
}

export interface StrategyAdjustment {
  parameter: keyof import('../config').TradingStrategyParams;
  oldValue: number;
  newValue: number;
  reason: string;
}
