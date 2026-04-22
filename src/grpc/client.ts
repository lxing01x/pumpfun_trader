import * as grpc from '@grpc/grpc-js';
import { GRPCConfig } from '../config';
import { TokenTrade, TokenData } from '../types';
import { EventEmitter } from 'events';

export interface PumpfunTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tradeType: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  price: number;
  trader: string;
}

export class GRPCClient extends EventEmitter {
  private client: any;
  private config: GRPCConfig;
  private isConnected: boolean = false;

  constructor(config: GRPCConfig) {
    super();
    this.config = config;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Connecting to gRPC server: ${this.config.url}`);
        
        const metadata = new grpc.Metadata();
        metadata.add('authorization', `Bearer ${this.config.token}`);

        const channelCredentials = grpc.credentials.createSsl();
        const callCredentials = grpc.credentials.createFromMetadataGenerator(
          (params, callback) => {
            callback(null, metadata);
          }
        );
        const combinedCredentials = grpc.credentials.combineChannelCredentials(
          channelCredentials,
          callCredentials
        );

        const PumpfunService = this.createServiceDefinition();
        
        this.client = new (PumpfunService as any)(
          this.config.url,
          combinedCredentials
        );

        this.isConnected = true;
        console.log('gRPC client connected successfully');
        resolve();
      } catch (error) {
        console.error('Failed to connect to gRPC server:', error);
        reject(error);
      }
    });
  }

  private createServiceDefinition(): any {
    const ServiceClient = grpc.makeGenericClientConstructor(
      {},
      'PumpfunService',
      {}
    );
    return ServiceClient;
  }

  public subscribeToTransactions(): void {
    if (!this.isConnected) {
      throw new Error('Client not connected. Call connect() first.');
    }

    console.log('Subscribing to Pumpfun transactions...');

    const call = this.client.makeServerStreamRequest(
      '/pumpfun.v1.PumpfunService/SubscribeTransactions',
      (message: any) => message,
      (message: any) => message,
      {}
    );

    call.on('data', (data: any) => {
      try {
        const transaction = this.parseTransaction(data);
        this.emit('transaction', transaction);
      } catch (error) {
        console.error('Error parsing transaction:', error);
      }
    });

    call.on('error', (error: Error) => {
      console.error('gRPC stream error:', error);
      this.emit('error', error);
    });

    call.on('end', () => {
      console.log('gRPC stream ended');
      this.emit('streamEnd');
    });
  }

  private parseTransaction(data: any): PumpfunTransaction {
    return {
      signature: data.signature || data.transactionSignature || '',
      slot: data.slot || 0,
      timestamp: data.timestamp || Date.now(),
      tokenMint: data.tokenMint || data.mint || '',
      tokenSymbol: data.tokenSymbol || data.symbol || '',
      tokenName: data.tokenName || data.name || '',
      tradeType: (data.tradeType || data.type || 'buy') as 'buy' | 'sell',
      solAmount: data.solAmount || data.lamports / 1e9 || 0,
      tokenAmount: data.tokenAmount || data.amount || 0,
      price: data.price || 0,
      trader: data.trader || data.buyer || data.seller || '',
    };
  }

  public disconnect(): void {
    if (this.client) {
      this.client.close();
      this.isConnected = false;
      console.log('gRPC client disconnected');
    }
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }
}
