export interface TokenData {
  mintAddress: string;
  currentPrice: number;
  lastPrice: number;
  volume24h: number;
  volume10m: number;
  volume30s: number;
  buyVolume30s: number;
  sellVolume30s: number;
  priceChangePercent5s: number;
  priceChangePercent30s: number;
  priceChangePercent1m: number;
  priceChangePercent5m: number;
  priceChangePercent10m: number;
  lastUpdate: number;
  trades: TokenTrade[];
  highestPrice: number;
  highestPriceTimestamp: number;
  dropFromHighestPercent: number;
  tradeCount5s: number;
  tradeCount10s: number;
  tradeCount30s: number;
  tradeCount1m: number;
  buySellRatio: number;
  buySellCountRatio: number;
  volumeTrendRatio: number;
  volatility30s: number;
  hasSharpDrop: boolean;
  hasGradualDrop: boolean;
  hasRecentDrop: boolean;
  isPumping: boolean;
  isCrashing: boolean;
  hasExtremeMove: boolean;
  tradeFrequency1m: number;
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
  buyFeeAmount: number;
  buyFeePercent: number;
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
  profitLossAfterFees: number;
  profitLossPercentAfterFees: number;
  buyFeeAmount: number;
  buyFeePercent: number;
  sellFeeAmount: number;
  sellFeePercent: number;
  totalFees: number;
  exitReason: 'take_profit' | 'stop_loss' | 'time_limit' | 'manual' | 'sharp_drop' | 'crash' | 'sell_pressure' | 'partial_take_profit' | 'trailing_stop';
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
  totalProfitLossAfterFees: number;
  totalProfitLossPercentAfterFees: number;
  totalFees: number;
  profitFactor: number;
  averageProfit: number;
  averageLoss: number;
  averageHoldTimeMinutes: number;
  isProfitable: boolean;
  isProfitableAfterFees: boolean;
}

export interface StrategyAdjustment {
  parameter: keyof import('../config').TradingStrategyParams;
  oldValue: number;
  newValue: number;
  reason: string;
}
