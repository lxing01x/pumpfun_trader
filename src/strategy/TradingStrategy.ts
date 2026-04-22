import { TradingStrategyParams } from '../config';
import { TokenData, Position, ClosedPosition } from '../types';
import { EventEmitter } from 'events';

export interface BuySignal {
  tokenMint: string;
  price: number;
  reason: string;
  timestamp: number;
}

export interface SellSignal {
  positionId: string;
  tokenMint: string;
  price: number;
  reason: 'take_profit' | 'stop_loss' | 'time_limit';
  timestamp: number;
}

export class TradingStrategy extends EventEmitter {
  private params: TradingStrategyParams;
  private positions: Map<string, Position> = new Map();
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

  public checkBuySignal(token: TokenData): boolean {
    if (this.positions.has(token.mintAddress)) {
      return false;
    }

    const volumeCondition = token.volume30s >= this.params.minVolume;
    const priceChangeCondition = 
      token.priceChangePercent30s >= this.params.minPriceChangePercent &&
      token.priceChangePercent30s <= this.params.maxPriceChangePercent;

    const shouldBuy = volumeCondition && priceChangeCondition;

    if (shouldBuy) {
      const shortMint = token.mintAddress.length > 8 
        ? `${token.mintAddress.substring(0, 4)}...${token.mintAddress.substring(token.mintAddress.length - 4)}` 
        : token.mintAddress;

      const buySignal: BuySignal = {
        tokenMint: token.mintAddress,
        price: token.currentPrice,
        reason: `Volume: ${token.volume30s.toFixed(2)} SOL, Price change (30s): ${token.priceChangePercent30s.toFixed(2)}%`,
        timestamp: Date.now(),
      };
      this.emit('buySignal', buySignal);
      console.log(`[BUY SIGNAL] ${shortMint} - ${buySignal.reason}`);
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

      const shortMint = position.tokenMint.length > 8 
        ? `${position.tokenMint.substring(0, 4)}...${position.tokenMint.substring(position.tokenMint.length - 4)}` 
        : position.tokenMint;

      if (position.currentPrice >= position.takeProfitPrice) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: position.currentPrice,
          reason: 'take_profit',
          timestamp: now,
        });
        continue;
      }

      if (position.currentPrice <= position.stopLossPrice) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: position.currentPrice,
          reason: 'stop_loss',
          timestamp: now,
        });
        continue;
      }

      const holdTimeMs = now - position.entryTimestamp;
      const holdTimeMinutes = holdTimeMs / (60 * 1000);
      if (holdTimeMinutes >= this.params.maxHoldTimeMinutes) {
        sellSignals.push({
          positionId,
          tokenMint: position.tokenMint,
          price: position.currentPrice,
          reason: 'time_limit',
          timestamp: now,
        });
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

    const position: Position = {
      id: positionId,
      tokenMint,
      tokenSymbol: '',
      entryPrice,
      amount,
      entryTimestamp: Date.now(),
      currentPrice: entryPrice,
      stopLossPrice: entryPrice * (1 - this.params.stopLossPercent / 100),
      takeProfitPrice: entryPrice * (1 + this.params.takeProfitPercent / 100),
    };

    this.positions.set(positionId, position);
    
    const shortMint = tokenMint.length > 8 
      ? `${tokenMint.substring(0, 4)}...${tokenMint.substring(tokenMint.length - 4)}` 
      : tokenMint;
    
    console.log(`Opened position: ${positionId} - ${shortMint} at ${entryPrice.toExponential(4)}`);

    return position;
  }

  public closePosition(
    positionId: string,
    exitPrice: number,
    reason: ClosedPosition['exitReason']
  ): ClosedPosition | null {
    const position = this.positions.get(positionId);
    if (!position) return null;

    const now = Date.now();
    const holdTimeMs = now - position.entryTimestamp;
    const holdTimeMinutes = holdTimeMs / (60 * 1000);

    const profitLoss = (exitPrice - position.entryPrice) * position.amount;
    const profitLossPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

    const closedPosition: ClosedPosition = {
      id: positionId,
      tokenMint: position.tokenMint,
      tokenSymbol: '',
      entryPrice: position.entryPrice,
      exitPrice,
      amount: position.amount,
      entryTimestamp: position.entryTimestamp,
      exitTimestamp: now,
      holdTimeMinutes,
      profitLoss,
      profitLossPercent,
      exitReason: reason,
    };

    this.closedPositions.push(closedPosition);
    this.positions.delete(positionId);

    const shortMint = position.tokenMint.length > 8 
      ? `${position.tokenMint.substring(0, 4)}...${position.tokenMint.substring(position.tokenMint.length - 4)}` 
      : position.tokenMint;

    console.log(
      `Closed position: ${positionId} - ${shortMint} ` +
      `at ${exitPrice.toExponential(4)}, P/L: ${profitLossPercent.toFixed(2)}%, Reason: ${reason}`
    );

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
