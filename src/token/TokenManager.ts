import { TokenData, TokenTrade } from '../types';
import { PumpfunTransaction } from '../grpc/client';

export interface FilteredTrade {
  trade: TokenTrade;
  filteredReason: 'small_amount' | 'price_anomaly' | 'none';
}

export class TokenManager {
  private tokens: Map<string, TokenData> = new Map();
  private maxTradesPerToken: number = 200;
  private minSolAmount: number = 0.01;
  private maxPriceChangePerTrade: number = 50;

  public updateTokenData(transaction: PumpfunTransaction): TokenData | null {
    if (transaction.solAmount < this.minSolAmount) {
      const shortMint = transaction.tokenMint.length > 8 
        ? `${transaction.tokenMint.substring(0, 4)}...${transaction.tokenMint.substring(transaction.tokenMint.length - 4)}` 
        : transaction.tokenMint;
      console.log(`[FILTER] Skipping small trade: ${shortMint} | SOL: ${transaction.solAmount.toFixed(6)} (min: ${this.minSolAmount})`);
      return null;
    }

    const existingToken = this.tokens.get(transaction.tokenMint);
    const now = Date.now();

    const trade: TokenTrade = {
      transactionId: transaction.signature,
      type: transaction.tradeType,
      price: transaction.price,
      amount: transaction.tokenAmount,
      solAmount: transaction.solAmount,
      timestamp: transaction.timestamp,
      trader: transaction.trader,
    };

    if (existingToken) {
      const priceChangePercent = Math.abs((transaction.price - existingToken.currentPrice) / existingToken.currentPrice) * 100;
      if (priceChangePercent > this.maxPriceChangePerTrade) {
        const shortMint = transaction.tokenMint.length > 8 
          ? `${transaction.tokenMint.substring(0, 4)}...${transaction.tokenMint.substring(transaction.tokenMint.length - 4)}` 
          : transaction.tokenMint;
        console.log(`[FILTER] Skipping price anomaly: ${shortMint} | Price change: ${priceChangePercent.toFixed(2)}% (max: ${this.maxPriceChangePerTrade}%)`);
        return existingToken;
      }
    }

    if (!existingToken) {
      const tokenData: TokenData = {
        mintAddress: transaction.tokenMint,
        currentPrice: transaction.price,
        lastPrice: 0,
        volume24h: transaction.solAmount,
        volume10m: transaction.solAmount,
        volume30s: transaction.solAmount,
        buyVolume30s: transaction.tradeType === 'buy' ? transaction.solAmount : 0,
        sellVolume30s: transaction.tradeType === 'sell' ? transaction.solAmount : 0,
        priceChangePercent5s: 0,
        priceChangePercent30s: 0,
        priceChangePercent1m: 0,
        priceChangePercent5m: 0,
        priceChangePercent10m: 0,
        lastUpdate: now,
        trades: [trade],
        highestPrice: transaction.price,
        highestPriceTimestamp: now,
        dropFromHighestPercent: 0,
        tradeCount5s: 1,
        tradeCount10s: 1,
        tradeCount30s: 1,
        tradeCount1m: 1,
        buySellRatio: transaction.tradeType === 'buy' ? 10 : 0.1,
        buySellCountRatio: transaction.tradeType === 'buy' ? 10 : 0.1,
        volumeTrendRatio: 1,
        volatility30s: 0,
        hasSharpDrop: false,
        hasGradualDrop: false,
        hasRecentDrop: false,
        isPumping: false,
        isCrashing: false,
        hasExtremeMove: false,
        tradeFrequency1m: 0,
      };
      this.tokens.set(transaction.tokenMint, tokenData);
      return tokenData;
    }

    existingToken.lastPrice = existingToken.currentPrice;
    existingToken.currentPrice = transaction.price;
    existingToken.lastUpdate = now;

    if (transaction.price > existingToken.highestPrice) {
      existingToken.highestPrice = transaction.price;
      existingToken.highestPriceTimestamp = now;
    }

    existingToken.trades.push(trade);
    if (existingToken.trades.length > this.maxTradesPerToken) {
      existingToken.trades = existingToken.trades.slice(-this.maxTradesPerToken);
    }

    this.calculatePriceChanges(existingToken, now);
    this.calculateVolumes(existingToken, now);
    this.calculateAdvancedMetrics(existingToken, now);

    this.tokens.set(transaction.tokenMint, existingToken);
    return existingToken;
  }

  private calculatePriceChanges(token: TokenData, now: number): void {
    const fiveSecondsAgo = now - 5 * 1000;
    const thirtySecondsAgo = now - 30 * 1000;
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const tenMinutesAgo = now - 10 * 60 * 1000;

    const trades5s = token.trades.filter(t => t.timestamp >= fiveSecondsAgo);
    const trades30s = token.trades.filter(t => t.timestamp >= thirtySecondsAgo);
    const trades1m = token.trades.filter(t => t.timestamp >= oneMinuteAgo);
    const trades5m = token.trades.filter(t => t.timestamp >= fiveMinutesAgo);
    const trades10m = token.trades.filter(t => t.timestamp >= tenMinutesAgo);

    token.priceChangePercent5s = this.calculatePriceChangeFromTrades(token.currentPrice, trades5s);
    token.priceChangePercent30s = this.calculatePriceChangeFromTrades(token.currentPrice, trades30s);
    token.priceChangePercent1m = this.calculatePriceChangeFromTrades(token.currentPrice, trades1m);
    token.priceChangePercent5m = this.calculatePriceChangeFromTrades(token.currentPrice, trades5m);
    token.priceChangePercent10m = this.calculatePriceChangeFromTrades(token.currentPrice, trades10m);
  }

  private calculatePriceChangeFromTrades(currentPrice: number, trades: TokenTrade[]): number {
    if (trades.length === 0) return 0;
    
    const earliestTrade = trades.reduce((earliest, trade) => 
      trade.timestamp < earliest.timestamp ? trade : earliest
    );
    
    if (earliestTrade.price === 0) return 0;
    
    return ((currentPrice - earliestTrade.price) / earliestTrade.price) * 100;
  }

  private calculateVolumes(token: TokenData, now: number): void {
    const thirtySecondsAgo = now - 30 * 1000;
    const tenMinutesAgo = now - 10 * 60 * 1000;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const trades30s = token.trades.filter(t => t.timestamp >= thirtySecondsAgo);
    const trades10m = token.trades.filter(t => t.timestamp >= tenMinutesAgo);
    const trades24h = token.trades.filter(t => t.timestamp >= twentyFourHoursAgo);

    token.volume30s = trades30s.reduce((sum, t) => sum + t.solAmount, 0);
    token.volume10m = trades10m.reduce((sum, t) => sum + t.solAmount, 0);
    token.volume24h = trades24h.reduce((sum, t) => sum + t.solAmount, 0);

    token.buyVolume30s = trades30s.filter(t => t.type === 'buy').reduce((sum, t) => sum + t.solAmount, 0);
    token.sellVolume30s = trades30s.filter(t => t.type === 'sell').reduce((sum, t) => sum + t.solAmount, 0);
  }

  private calculateAdvancedMetrics(token: TokenData, now: number): void {
    const fiveSecondsAgo = now - 5 * 1000;
    const thirtySecondsAgo = now - 30 * 1000;
    const tenSecondsAgo = now - 10 * 1000;
    const oneMinuteAgo = now - 60 * 1000;

    const trades5s = token.trades.filter(t => t.timestamp >= fiveSecondsAgo);
    const trades10s = token.trades.filter(t => t.timestamp >= tenSecondsAgo);
    const trades30s = token.trades.filter(t => t.timestamp >= thirtySecondsAgo);
    const trades1m = token.trades.filter(t => t.timestamp >= oneMinuteAgo);

    token.tradeCount5s = trades5s.length;
    token.tradeCount10s = trades10s.length;
    token.tradeCount30s = trades30s.length;
    token.tradeCount1m = trades1m.length;

    if (token.highestPrice > 0) {
      token.dropFromHighestPercent = ((token.highestPrice - token.currentPrice) / token.highestPrice) * 100;
    } else {
      token.dropFromHighestPercent = 0;
    }

    const totalBuyVolume = token.buyVolume30s || 0;
    const totalSellVolume = token.sellVolume30s || 0;
    if (totalSellVolume > 0) {
      token.buySellRatio = totalBuyVolume / totalSellVolume;
    } else if (totalBuyVolume > 0) {
      token.buySellRatio = 10;
    } else {
      token.buySellRatio = 1;
    }

    const buyCount30s = trades30s.filter(t => t.type === 'buy').length;
    const sellCount30s = trades30s.length - buyCount30s;
    if (sellCount30s > 0) {
      token.buySellCountRatio = buyCount30s / sellCount30s;
    } else if (buyCount30s > 0) {
      token.buySellCountRatio = 10;
    } else {
      token.buySellCountRatio = 1;
    }

    if (trades1m.length >= 2) {
      const sortedTrades = [...trades1m].sort((a, b) => a.timestamp - b.timestamp);
      const firstHalf = sortedTrades.slice(0, Math.floor(sortedTrades.length / 2));
      const secondHalf = sortedTrades.slice(Math.floor(sortedTrades.length / 2));
      
      const firstHalfVolume = firstHalf.reduce((sum, t) => sum + t.solAmount, 0);
      const secondHalfVolume = secondHalf.reduce((sum, t) => sum + t.solAmount, 0);
      
      if (firstHalfVolume > 0) {
        token.volumeTrendRatio = secondHalfVolume / firstHalfVolume;
      } else {
        token.volumeTrendRatio = 1;
      }

      if (sortedTrades.length >= 3) {
        const recentTrades = sortedTrades.slice(-3);
        let sharpDropCount = 0;
        let gradualDropCount = 0;
        
        for (let i = 1; i < recentTrades.length; i++) {
          const prevTrade = recentTrades[i - 1];
          const currTrade = recentTrades[i];
          const priceChange = ((currTrade.price - prevTrade.price) / prevTrade.price) * 100;
          
          if (priceChange < -15) {
            sharpDropCount++;
          } else if (priceChange < -5) {
            gradualDropCount++;
          }
        }
        
        token.hasSharpDrop = sharpDropCount > 0;
        token.hasGradualDrop = gradualDropCount >= 2;
        token.hasRecentDrop = token.hasSharpDrop || token.hasGradualDrop;
      }
    }

    if (trades30s.length >= 4) {
      const sortedByTime = [...trades30s].sort((a, b) => a.timestamp - b.timestamp);
      let volatilitySum = 0;
      
      for (let i = 1; i < sortedByTime.length; i++) {
        const prev = sortedByTime[i - 1];
        const curr = sortedByTime[i];
        volatilitySum += Math.abs((curr.price - prev.price) / prev.price) * 100;
      }
      
      token.volatility30s = volatilitySum / (sortedByTime.length - 1);
      
      if (sortedByTime.length >= 5) {
        const recent5 = sortedByTime.slice(-5);
        const firstPrice = recent5[0].price;
        const lastPrice = recent5[recent5.length - 1].price;
        const totalChange = ((lastPrice - firstPrice) / firstPrice) * 100;
        
        token.isCrashing = totalChange < -20 && token.volatility30s > 5;
        token.isPumping = totalChange > 20 && token.volatility30s > 5;
        token.hasExtremeMove = token.isCrashing || token.isPumping;
      }
    }

    if (trades1m.length >= 3) {
      const sorted1m = [...trades1m].sort((a, b) => a.timestamp - b.timestamp);
      const avgTimeBetweenTrades = (sorted1m[sorted1m.length - 1].timestamp - sorted1m[0].timestamp) / (sorted1m.length - 1);
      token.tradeFrequency1m = avgTimeBetweenTrades > 0 ? 60000 / avgTimeBetweenTrades : 0;
    }
  }

  public getTokenData(mintAddress: string): TokenData | undefined {
    return this.tokens.get(mintAddress);
  }

  public getAllTokens(): TokenData[] {
    return Array.from(this.tokens.values());
  }

  public getTokensByVolume(minVolume: number): TokenData[] {
    return this.getAllTokens().filter(t => t.volume30s >= minVolume);
  }

  public getTokensWithPriceChange(minPercent: number, maxPercent: number): TokenData[] {
    return this.getAllTokens().filter(t => {
      const change = t.priceChangePercent30s;
      return change >= minPercent && change <= maxPercent;
    });
  }

  public cleanupOldTokens(maxAgeMinutes: number = 30): number {
    const cutoffTime = Date.now() - maxAgeMinutes * 60 * 1000;
    let removedCount = 0;

    for (const [mint, token] of this.tokens.entries()) {
      if (token.lastUpdate < cutoffTime) {
        this.tokens.delete(mint);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} old tokens`);
    }

    return removedCount;
  }
}
