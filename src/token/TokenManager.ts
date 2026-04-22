import { TokenData, TokenTrade } from '../types';
import { PumpfunTransaction } from '../grpc/client';

export class TokenManager {
  private tokens: Map<string, TokenData> = new Map();
  private maxTradesPerToken: number = 200;

  public updateTokenData(transaction: PumpfunTransaction): TokenData {
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

    if (!existingToken) {
      const tokenData: TokenData = {
        mintAddress: transaction.tokenMint,
        currentPrice: transaction.price,
        lastPrice: 0,
        volume24h: transaction.solAmount,
        volume10m: transaction.solAmount,
        volume30s: transaction.solAmount,
        priceChangePercent30s: 0,
        priceChangePercent1m: 0,
        priceChangePercent5m: 0,
        priceChangePercent10m: 0,
        lastUpdate: now,
        trades: [trade],
      };
      this.tokens.set(transaction.tokenMint, tokenData);
      return tokenData;
    }

    existingToken.lastPrice = existingToken.currentPrice;
    existingToken.currentPrice = transaction.price;
    existingToken.lastUpdate = now;

    existingToken.trades.push(trade);
    if (existingToken.trades.length > this.maxTradesPerToken) {
      existingToken.trades = existingToken.trades.slice(-this.maxTradesPerToken);
    }

    this.calculatePriceChanges(existingToken, now);
    this.calculateVolumes(existingToken, now);

    this.tokens.set(transaction.tokenMint, existingToken);
    return existingToken;
  }

  private calculatePriceChanges(token: TokenData, now: number): void {
    const thirtySecondsAgo = now - 30 * 1000;
    const oneMinuteAgo = now - 60 * 1000;
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const tenMinutesAgo = now - 10 * 60 * 1000;

    const trades30s = token.trades.filter(t => t.timestamp >= thirtySecondsAgo);
    const trades1m = token.trades.filter(t => t.timestamp >= oneMinuteAgo);
    const trades5m = token.trades.filter(t => t.timestamp >= fiveMinutesAgo);
    const trades10m = token.trades.filter(t => t.timestamp >= tenMinutesAgo);

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
