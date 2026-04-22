import { TradingStrategyParams } from '../config';
import { TokenData, Position, ClosedPosition } from '../types';
import { EventEmitter } from 'events';

export interface BuySignal {
  tokenMint: string;
  price: number;
  reason: string;
  timestamp: number;
  confidence: number;
  metrics: BuyMetrics;
}

export interface BuyMetrics {
  tradeCount5s: number;
  priceChange5s: number;
  volume30s: number;
  buySellRatio: number;
  dropFromHighest: number;
  volumeTrend: number;
  tradeFrequency: number;
}

export interface SellSignal {
  positionId: string;
  tokenMint: string;
  price: number;
  reason: 'take_profit' | 'stop_loss' | 'time_limit' | 'sharp_drop' | 'crash' | 'sell_pressure' | 'partial_take_profit' | 'trailing_stop';
  timestamp: number;
  isPartial?: boolean;
  sellRatio?: number;
}

export interface ExtendedPosition extends Position {
  highestPrice: number;
  partialSold: boolean;
  partialSoldAmount: number;
  trailingStopPrice: number;
}

export class TradingStrategy extends EventEmitter {
  private params: TradingStrategyParams;
  private positions: Map<string, ExtendedPosition> = new Map();
  private closedPositions: ClosedPosition[] = [];

  constructor(params: TradingStrategyParams) {
    super();
    this.params = { ...params };
  }

  public updateParams(params: Partial<TradingStrategyParams>): void {
    this.params = { ...this.params, ...params };
    console.log('Strategy parameters updated:', this.params);
  }

  public getParams(): TradingStrategyParams {
    return { ...this.params };
  }

  private calculateBuyConfidence(token: TokenData): { confidence: number; metrics: BuyMetrics; reasons: string[] } {
    const reasons: string[] = [];
    let confidence = 0;
    const maxConfidence = 100;

    const metrics: BuyMetrics = {
      tradeCount5s: token.tradeCount5s,
      priceChange5s: token.priceChangePercent5s,
      volume30s: token.volume30s,
      buySellRatio: token.buySellRatio,
      dropFromHighest: token.dropFromHighestPercent,
      volumeTrend: token.volumeTrendRatio || 1,
      tradeFrequency: token.tradeFrequency1m,
    };

    if (token.volume30s >= this.params.minVolume) {
      const volumeScore = Math.min((token.volume30s / this.params.minVolume) * 15, 20);
      confidence += volumeScore;
      reasons.push(`Volume: ${token.volume30s.toFixed(2)} SOL (score: ${volumeScore.toFixed(1)})`);
    }

    if (token.tradeCount5s >= this.params.minTradeCount5s) {
      const tradeCountScore = Math.min((token.tradeCount5s / this.params.minTradeCount5s) * 10, 15);
      confidence += tradeCountScore;
      reasons.push(`Trades (5s): ${token.tradeCount5s} (score: ${tradeCountScore.toFixed(1)})`);
    }

    if (token.priceChangePercent5s >= this.params.minPriceChange5sPercent) {
      const momentumScore = Math.min(token.priceChangePercent5s * 2, 20);
      confidence += momentumScore;
      reasons.push(`Price change (5s): ${token.priceChangePercent5s.toFixed(2)}% (score: ${momentumScore.toFixed(1)})`);
    }

    if (token.priceChangePercent30s >= this.params.minPriceChangePercent && 
        token.priceChangePercent30s <= this.params.maxPriceChangePercent) {
      confidence += 10;
      reasons.push(`Price change (30s): ${token.priceChangePercent30s.toFixed(2)}% (in range)`);
    }

    if (token.dropFromHighestPercent <= this.params.maxDropFromHighestPercent) {
      const dropScore = Math.max(0, 15 - token.dropFromHighestPercent);
      confidence += dropScore;
      reasons.push(`Drop from highest: ${token.dropFromHighestPercent.toFixed(2)}% (score: ${dropScore.toFixed(1)})`);
    }

    if (token.buySellRatio >= this.params.minBuySellRatio) {
      const buyPressureScore = Math.min(token.buySellRatio * 5, 15);
      confidence += buyPressureScore;
      reasons.push(`Buy/Sell ratio: ${token.buySellRatio.toFixed(2)} (score: ${buyPressureScore.toFixed(1)})`);
    }

    if (token.buySellCountRatio >= this.params.minBuySellCountRatio) {
      confidence += 5;
      reasons.push(`Buy/Sell count ratio: ${token.buySellCountRatio.toFixed(2)}`);
    }

    if (token.volumeTrendRatio && token.volumeTrendRatio >= this.params.minVolumeTrendRatio) {
      confidence += 5;
      reasons.push(`Volume trend: ${token.volumeTrendRatio.toFixed(2)}x increasing`);
    }

    if (token.tradeFrequency1m >= this.params.minTradeFrequency1m) {
      confidence += 5;
      reasons.push(`Trade frequency: ${token.tradeFrequency1m.toFixed(1)}/min`);
    }

    if (token.isCrashing || token.hasSharpDrop) {
      confidence = Math.max(0, confidence - 30);
      reasons.push(`[WARNING] Crashing/sharp drop detected - confidence reduced`);
    }

    if (token.hasExtremeMove) {
      confidence = Math.max(0, confidence - 20);
      reasons.push(`[WARNING] Extreme volatility - confidence reduced`);
    }

    return { confidence: Math.min(confidence, maxConfidence), metrics, reasons };
  }

  public checkBuySignal(token: TokenData): boolean {
    if (this.hasOpenPosition(token.mintAddress)) {
      return false;
    }

    if (token.isCrashing || token.hasSharpDrop) {
      return false;
    }

    const { confidence, metrics, reasons } = this.calculateBuyConfidence(token);
    
    const confidenceThreshold = 40;
    const shouldBuy = confidence >= confidenceThreshold;

    if (shouldBuy) {
      const shortMint = token.mintAddress.length > 8 
        ? `${token.mintAddress.substring(0, 4)}...${token.mintAddress.substring(token.mintAddress.length - 4)}` 
        : token.mintAddress;

      const reasonText = reasons.join(' | ');
      const buySignal: BuySignal = {
        tokenMint: token.mintAddress,
        price: token.currentPrice,
        reason: reasonText,
        timestamp: Date.now(),
        confidence,
        metrics,
      };
      this.emit('buySignal', buySignal);
      
      console.log('\n' + '='.repeat(60));
      console.log(`[BUY SIGNAL] ${shortMint} | Confidence: ${confidence.toFixed(1)}%`);
      console.log('='.repeat(60));
      reasons.forEach(r => console.log(`  ${r}`));
      console.log(`  Price: ${token.currentPrice.toExponential(4)}`);
      console.log(`  Volume (30s): ${token.volume30s.toFixed(2)} SOL`);
      console.log(`  Buy/Sell Ratio: ${token.buySellRatio.toFixed(2)}`);
      console.log('='.repeat(60) + '\n');
    }

    return shouldBuy;
  }

  public checkSellSignals(tokens: Map<string, TokenData>): SellSignal[] {
    const sellSignals: SellSignal[] = [];
    const now = Date.now();

    for (const [positionId, position] of this.positions.entries()) {
      const token = tokens.get(position.tokenMint);
      if (!token) continue;

      position.currentPrice = token.currentPrice;

      if (token.currentPrice > position.highestPrice) {
        position.highestPrice = token.currentPrice;
        if (this.params.enableTrailingStop) {
          position.trailingStopPrice = token.currentPrice * (1 - this.params.trailingStopPercent / 100);
        }
      }

      const shortMint = position.tokenMint.length > 8 
        ? `${position.tokenMint.substring(0, 4)}...${position.tokenMint.substring(position.tokenMint.length - 4)}` 
        : position.tokenMint;

      const currentProfitPercent = ((token.currentPrice - position.entryPrice) / position.entryPrice) * 100;

      if (this.params.enablePartialTakeProfit && 
          !position.partialSold && 
          currentProfitPercent >= this.params.partialTakeProfitPercent) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'partial_take_profit',
          timestamp: now,
          isPartial: true,
          sellRatio: this.params.partialSellRatio,
        });
        console.log(`[PARTIAL TAKE PROFIT] ${shortMint} | Profit: ${currentProfitPercent.toFixed(2)}% | Selling ${(this.params.partialSellRatio * 100).toFixed(0)}%`);
        position.partialSold = true;
        position.partialSoldAmount = position.amount * this.params.partialSellRatio;
      }

      if (token.currentPrice >= position.takeProfitPrice) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'take_profit',
          timestamp: now,
        });
        console.log(`[TAKE PROFIT] ${shortMint} | Price: ${token.currentPrice.toExponential(4)} | Target: ${position.takeProfitPrice.toExponential(4)}`);
        continue;
      }

      if (this.params.enableTrailingStop && 
          position.trailingStopPrice > 0 && 
          token.currentPrice <= position.trailingStopPrice &&
          currentProfitPercent > 0) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'trailing_stop',
          timestamp: now,
        });
        console.log(`[TRAILING STOP] ${shortMint} | Current: ${token.currentPrice.toExponential(4)} | Trail Stop: ${position.trailingStopPrice.toExponential(4)} | Highest: ${position.highestPrice.toExponential(4)}`);
        continue;
      }

      if (token.isCrashing) {
        const crashStopPrice = position.entryPrice * (1 - (this.params.stopLossPercent * this.params.crashStopMultiplier) / 100);
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'crash',
          timestamp: now,
        });
        console.log(`[CRASH SELL] ${shortMint} | Crash detected! Immediate exit`);
        continue;
      }

      if (token.hasSharpDrop && currentProfitPercent < 0) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'sharp_drop',
          timestamp: now,
        });
        console.log(`[SHARP DROP SELL] ${shortMint} | Sharp drop detected | P/L: ${currentProfitPercent.toFixed(2)}%`);
        continue;
      }

      if (token.hasGradualDrop && currentProfitPercent < -1) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'sharp_drop',
          timestamp: now,
        });
        console.log(`[GRADUAL DROP SELL] ${shortMint} | Gradual decline detected | P/L: ${currentProfitPercent.toFixed(2)}%`);
        continue;
      }

      if (token.currentPrice <= position.stopLossPrice) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'stop_loss',
          timestamp: now,
        });
        console.log(`[STOP LOSS] ${shortMint} | Price: ${token.currentPrice.toExponential(4)} | Stop: ${position.stopLossPrice.toExponential(4)}`);
        continue;
      }

      if (token.buySellRatio < 0.5 && token.sellVolume30s > token.buyVolume30s * 2 && currentProfitPercent < 0) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'sell_pressure',
          timestamp: now,
        });
        console.log(`[SELL PRESSURE] ${shortMint} | B/S Ratio: ${token.buySellRatio.toFixed(2)} | Strong selling detected`);
        continue;
      }

      const holdTimeMs = now - position.entryTimestamp;
      const holdTimeMinutes = holdTimeMs / (60 * 1000);
      if (holdTimeMinutes >= this.params.maxHoldTimeMinutes) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: token.currentPrice,
          reason: 'time_limit',
          timestamp: now,
        });
        console.log(`[TIME LIMIT] ${shortMint} | Held: ${holdTimeMinutes.toFixed(2)} min | Max: ${this.params.maxHoldTimeMinutes} min`);
      }
    }

    return sellSignals;
  }

  public openPosition(
    tokenMint: string,
    entryPrice: number,
    amount: number
  ): Position {
    const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const position: ExtendedPosition = {
      id: positionId,
      tokenMint,
      tokenSymbol: '',
      entryPrice,
      amount,
      entryTimestamp: Date.now(),
      currentPrice: entryPrice,
      stopLossPrice: entryPrice * (1 - this.params.stopLossPercent / 100),
      takeProfitPrice: entryPrice * (1 + this.params.takeProfitPercent / 100),
      highestPrice: entryPrice,
      partialSold: false,
      partialSoldAmount: 0,
      trailingStopPrice: 0,
    };

    this.positions.set(positionId, position);
    
    const shortMint = tokenMint.length > 8 
      ? `${tokenMint.substring(0, 4)}...${tokenMint.substring(tokenMint.length - 4)}` 
      : tokenMint;
    
    console.log(`\n[OPEN POSITION] ${positionId}`);
    console.log(`  Token: ${shortMint}`);
    console.log(`  Entry Price: ${entryPrice.toExponential(4)}`);
    console.log(`  Amount: ${amount}`);
    console.log(`  Stop Loss: ${position.stopLossPrice.toExponential(4)} (-${this.params.stopLossPercent}%)`);
    console.log(`  Take Profit: ${position.takeProfitPrice.toExponential(4)} (+${this.params.takeProfitPercent}%)`);
    console.log(`  Trailing Stop: ${this.params.enableTrailingStop ? `Enabled (${this.params.trailingStopPercent}%)` : 'Disabled'}`);
    console.log(`  Partial Take Profit: ${this.params.enablePartialTakeProfit ? `Enabled at ${this.params.partialTakeProfitPercent}%` : 'Disabled'}\n`);

    return position;
  }

  public closePosition(
    positionId: string,
    exitPrice: number,
    reason: ClosedPosition['exitReason'],
    isPartial: boolean = false,
    sellRatio: number = 1
  ): ClosedPosition | null {
    const position = this.positions.get(positionId);
    if (!position) return null;

    const now = Date.now();
    const holdTimeMs = now - position.entryTimestamp;
    const holdTimeMinutes = holdTimeMs / (60 * 1000);

    const sellAmount = isPartial ? position.amount * sellRatio : position.amount;
    const profitLoss = (exitPrice - position.entryPrice) * sellAmount;
    const profitLossPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    const closedPosition: ClosedPosition = {
      id: `${positionId}_${Date.now()}`,
      tokenMint: position.tokenMint,
      tokenSymbol: '',
      entryPrice: position.entryPrice,
      exitPrice,
      amount: sellAmount,
      entryTimestamp: position.entryTimestamp,
      exitTimestamp: now,
      holdTimeMinutes,
      profitLoss,
      profitLossPercent,
      exitReason: reason,
    };

    const shortMint = position.tokenMint.length > 8 
      ? `${position.tokenMint.substring(0, 4)}...${position.tokenMint.substring(position.tokenMint.length - 4)}` 
      : position.tokenMint;

    if (isPartial) {
      console.log(`\n[PARTIAL CLOSE] ${positionId}`);
      console.log(`  Token: ${shortMint}`);
      console.log(`  Sold: ${(sellRatio * 100).toFixed(0)}% | Amount: ${sellAmount.toFixed(0)}`);
      console.log(`  Exit Price: ${exitPrice.toExponential(4)}`);
      console.log(`  P/L: ${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}% (${profitLoss.toFixed(6)} SOL)`);
      console.log(`  Reason: ${reason}\n`);
      
      this.closedPositions.push(closedPosition);
      
      position.amount = position.amount - sellAmount;
      position.partialSoldAmount += sellAmount;
      
      if (position.amount <= 0) {
        this.positions.delete(positionId);
      } else {
        this.positions.set(positionId, position);
      }
      
      return closedPosition;
    }

    this.closedPositions.push(closedPosition);
    this.positions.delete(positionId);

    console.log(`\n[CLOSE POSITION] ${positionId}`);
    console.log(`  Token: ${shortMint}`);
    console.log(`  Entry: ${position.entryPrice.toExponential(4)} | Exit: ${exitPrice.toExponential(4)}`);
    console.log(`  P/L: ${profitLossPercent >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}% (${profitLoss.toFixed(6)} SOL)`);
    console.log(`  Hold Time: ${holdTimeMinutes.toFixed(2)} min`);
    console.log(`  Reason: ${reason}\n`);

    return closedPosition;
  }

  public getOpenPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public getClosedPositions(startTime?: number, endTime?: number): ClosedPosition[] {
    let positions = [...this.closedPositions];

    if (startTime) {
      positions = positions.filter(p => p.exitTimestamp >= startTime);
    }
    if (endTime) {
      positions = positions.filter(p => p.exitTimestamp <= endTime);
    }

    return positions;
  }

  public getPosition(positionId: string): Position | undefined {
    return this.positions.get(positionId);
  }

  public hasOpenPosition(tokenMint: string): boolean {
    return Array.from(this.positions.values()).some(p => p.tokenMint === tokenMint);
  }
}
