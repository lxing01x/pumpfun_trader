import Client, {
  CommitmentLevel,
  SubscribeRequest,
  SubscribeUpdate,
  SubscribeUpdateTransaction,
} from '@triton-one/yellowstone-grpc';
import { GRPCConfig } from '../config';
import { EventEmitter } from 'events';

export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export interface PumpfunTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  tokenMint: string;
  tradeType: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  price: number;
  trader: string;
}

export class GRPCClient extends EventEmitter {
  private client: Client | null = null;
  private config: GRPCConfig;
  private isConnected: boolean = false;
  private stream: any = null;

  constructor(config: GRPCConfig) {
    super();
    this.config = config;
  }

  public async connect(): Promise<void> {
    try {
      console.log(`Connecting to Yellowstone gRPC: ${this.config.url}`);

      this.client = new Client(
        this.config.url,
        this.config.token || undefined,
        undefined
      );

      this.isConnected = true;
      console.log('Yellowstone gRPC client created successfully');
    } catch (error) {
      console.error('Failed to create Yellowstone gRPC client:', error);
      throw error;
    }
  }

  public async subscribeToTransactions(): Promise<void> {
    if (!this.isConnected || !this.client) {
      throw new Error('Client not connected. Call connect() first.');
    }

    console.log('Subscribing to Pumpfun transactions...');
    console.log(`Filtering for program: ${PUMP_FUN_PROGRAM_ID}`);

    const request: SubscribeRequest = {
      accounts: {},
      slots: {},
      transactions: {
        pumpFun: {
          vote: false,
          failed: false,
          accountInclude: [PUMP_FUN_PROGRAM_ID],
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      entry: {},
      blocks: {},
      blocksMeta: {},
      accountsDataSlice: [],
      ping: undefined,
      commitment: CommitmentLevel.CONFIRMED,
    };

    try {
      this.stream = await this.client.subscribe();

      this.stream.on('data', (data: SubscribeUpdate) => {
        try {
          this.handleUpdate(data);
        } catch (error) {
          console.error('Error handling update:', error);
        }
      });

      this.stream.on('error', (error: Error) => {
        console.error('gRPC stream error:', error.message);
        this.emit('error', error);
      });

      this.stream.on('end', () => {
        console.log('gRPC stream ended');
        this.emit('streamEnd');
      });

      this.stream.write(request);
      console.log('Subscription request sent, waiting for transactions...');
    } catch (error) {
      console.error('Failed to subscribe:', error);
      throw error;
    }
  }

  private handleUpdate(data: SubscribeUpdate): void {
    if (data.transaction) {
      const tx = data.transaction;
      
      if (tx.transaction && tx.transaction.meta) {
        const transaction = this.parseTransaction(tx);
        if (transaction) {
          this.emit('transaction', transaction);
        }
      }
    }

    if (data.ping) {
      if (this.stream) {
        this.stream.write({ ping: { id: 1 } });
      }
    }
  }

  private parseTransaction(tx: SubscribeUpdateTransaction): PumpfunTransaction | null {
    try {
      const txInfo = tx.transaction;
      if (!txInfo) {
        return null;
      }

      const signature = txInfo.signature 
        ? Buffer.from(txInfo.signature).toString('hex')
        : '';

      const message = txInfo.transaction?.message;
      const meta = txInfo.meta;
      
      if (!message || !meta) {
        return null;
      }

      const accountKeys = message.accountKeys || [];

      let tokenMint = '';
      let tradeType: 'buy' | 'sell' = 'buy';
      let solAmount = 0;
      let tokenAmount = 0;
      let trader = '';

      const preBalances = meta.preBalances || [];
      const postBalances = meta.postBalances || [];
      
      if (preBalances.length > 0 && postBalances.length > 0) {
        const solDiff = Number(postBalances[0]) - Number(preBalances[0]);
        solAmount = Math.abs(solDiff) / 1e9;
        
        if (solDiff < 0) {
          tradeType = 'buy';
        } else {
          tradeType = 'sell';
        }
      }

      for (const account of accountKeys) {
        const addr = this.uint8ArrayToBase58(account);
        if (addr && addr.length >= 32 && addr !== PUMP_FUN_PROGRAM_ID) {
          tokenMint = addr;
          break;
        }
      }

      if (accountKeys.length > 0) {
        trader = this.uint8ArrayToBase58(accountKeys[0]) || 'unknown';
      }

      const tokenBalanceChanges = this.extractTokenBalanceChanges(meta);
      if (tokenBalanceChanges.length > 0) {
        tokenAmount = Math.abs(tokenBalanceChanges[0].change);
        tokenMint = tokenMint || tokenBalanceChanges[0].mint;
        
        if (tokenBalanceChanges[0].change < 0) {
          tradeType = 'sell';
        } else if (tokenBalanceChanges[0].change > 0) {
          tradeType = 'buy';
        }
      }

      const price = solAmount > 0 && tokenAmount > 0 ? solAmount / tokenAmount : 0;

      if (price <= 0) {
        return null;
      }

      if (!tokenMint || tokenMint.startsWith('unknown_')) {
        return null;
      }

      const slot = tx.slot ? parseInt(tx.slot, 10) : 0;

      const shortMint = tokenMint.length > 8 
        ? `${tokenMint.substring(0, 4)}...${tokenMint.substring(tokenMint.length - 4)}` 
        : tokenMint;

      console.log(`[${tradeType.toUpperCase()}] ${shortMint} | SOL: ${solAmount.toFixed(4)} | Price: ${price.toExponential(4)}`);

      const transaction: PumpfunTransaction = {
        signature: `0x${signature}`,
        slot,
        timestamp: Date.now(),
        tokenMint,
        tradeType,
        solAmount,
        tokenAmount,
        price,
        trader: trader || 'unknown',
      };

      return transaction;
    } catch (error) {
      console.error('Error parsing transaction:', error);
      return null;
    }
  }

  private uint8ArrayToBase58(arr: Uint8Array | undefined): string | null {
    if (!arr) return null;
    
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    
    let value = BigInt(0);
    for (let i = 0; i < arr.length; i++) {
      value = value * BigInt(256) + BigInt(arr[i]);
    }
    
    while (value > 0) {
      const remainder = Number(value % BigInt(58));
      result = alphabet[remainder] + result;
      value = value / BigInt(58);
    }
    
    for (let i = 0; i < arr.length && arr[i] === 0; i++) {
      result = '1' + result;
    }
    
    return result || '1';
  }

  private extractTokenBalanceChanges(meta: any): Array<{ mint: string; change: number }> {
    const changes: Array<{ mint: string; change: number }> = [];
    
    const preTokenBalances = meta?.preTokenBalances || [];
    const postTokenBalances = meta?.postTokenBalances || [];

    const preMap = new Map<number, any>();
    const postMap = new Map<number, any>();

    for (const bal of preTokenBalances) {
      preMap.set(bal.accountIndex, bal);
    }
    for (const bal of postTokenBalances) {
      postMap.set(bal.accountIndex, bal);
    }

    for (const [index, postBal] of postMap.entries()) {
      const preBal = preMap.get(index);
      if (preBal && postBal) {
        const preAmount = parseFloat(preBal.uiTokenAmount?.uiAmount || '0');
        const postAmount = parseFloat(postBal.uiTokenAmount?.uiAmount || '0');
        const change = postAmount - preAmount;
        
        if (change !== 0) {
          changes.push({
            mint: postBal.mint || preBal.mint || '',
            change,
          });
        }
      }
    }

    return changes;
  }

  private extractTokenSymbol(instructions: any[]): string | null {
    for (const ix of instructions) {
      const data = ix?.data;
      if (data && Buffer.isBuffer(data)) {
        const dataStr = data.toString();
        const symbolMatch = dataStr.match(/[A-Z]{3,10}/);
        if (symbolMatch) {
          return symbolMatch[0];
        }
      }
    }
    return null;
  }

  private extractTokenName(instructions: any[]): string | null {
    return null;
  }

  public async reconnect(): Promise<void> {
    try {
      this.disconnect();
      await this.connect();
      await this.subscribeToTransactions();
      console.log('Reconnected to Yellowstone gRPC successfully');
    } catch (error) {
      console.error('Reconnection failed:', error);
      throw error;
    }
  }

  public disconnect(): void {
    if (this.stream) {
      try {
        this.stream.end();
      } catch (e) {}
      this.stream = null;
    }
    
    if (this.client) {
      this.client = null;
    }
    
    this.isConnected = false;
    console.log('Yellowstone gRPC client disconnected');
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }
}
