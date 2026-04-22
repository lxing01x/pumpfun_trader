import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server } from 'http';
import { EventEmitter } from 'events';
import { configManager, Config, TradingStrategyParams, FeeConfig, RuntimeConfig, ApiConfig } from '../config';
import { TradingSession, SessionStatistics } from '../trade/TradeRecordManager';
import { AnalysisResult, ClosedPosition, Position, TokenData } from '../types';
import * as path from 'path';

export interface TradingStatus {
  isRunning: boolean;
  startTime?: number;
  uptimeSeconds?: number;
  currentSessionId?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ApiServer extends EventEmitter {
  private app: Express;
  private server: Server | null = null;
  private config: ApiConfig;
  private tradingStatus: TradingStatus;
  private tradeManager: any;
  private strategy: any;
  private analysisEngine: any;
  private tokenManager: any;

  constructor(apiConfig: ApiConfig) {
    super();
    this.config = { ...apiConfig };
    this.app = express();
    this.server = null;
    this.tradingStatus = {
      isRunning: false,
    };
    this.setupMiddleware();
    this.setupRoutes();
  }

  public setTradingComponents(
    tradeManager: any,
    strategy: any,
    analysisEngine: any,
    tokenManager: any
  ): void {
    this.tradeManager = tradeManager;
    this.strategy = strategy;
    this.analysisEngine = analysisEngine;
    this.tokenManager = tokenManager;
  }

  public setTradingStatus(status: Partial<TradingStatus>): void {
    this.tradingStatus = { ...this.tradingStatus, ...status };
    if (status.isRunning === true && !this.tradingStatus.startTime) {
      this.tradingStatus.startTime = Date.now();
    }
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, '../../public')));
  }

  private jsonResponse<T>(res: Response, success: boolean, data?: T, error?: string): void {
    const response: ApiResponse<T> = { success };
    if (data !== undefined) response.data = data;
    if (error) response.error = error;
    res.json(response);
  }

  private setupRoutes(): void {
    this.app.get('/', (req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    this.app.get('/api/status', this.getStatus.bind(this));
    this.app.get('/api/config', this.getConfig.bind(this));
    this.app.put('/api/config', this.updateConfig.bind(this));
    this.app.put('/api/config/strategy', this.updateStrategyConfig.bind(this));
    this.app.put('/api/config/fees', this.updateFeesConfig.bind(this));
    this.app.put('/api/config/runtime', this.updateRuntimeConfig.bind(this));
    
    this.app.post('/api/trading/start', this.startTrading.bind(this));
    this.app.post('/api/trading/stop', this.stopTrading.bind(this));
    this.app.get('/api/trading/positions', this.getOpenPositions.bind(this));
    this.app.get('/api/trading/closed-positions', this.getClosedPositions.bind(this));
    
    this.app.get('/api/statistics', this.getStatistics.bind(this));
    this.app.get('/api/sessions', this.getSessions.bind(this));
    this.app.get('/api/sessions/:sessionId', this.getSessionDetails.bind(this));
    
    this.app.get('/api/tokens', this.getActiveTokens.bind(this));

    this.app.use(this.errorHandler.bind(this));
  }

  private errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
    console.error('API Error:', err);
    this.jsonResponse(res, false, undefined, err.message || 'Internal Server Error');
  }

  private getStatus(req: Request, res: Response): void {
    const status: TradingStatus = {
      ...this.tradingStatus,
    };
    
    if (status.startTime) {
      status.uptimeSeconds = Math.floor((Date.now() - status.startTime) / 1000);
    }

    this.jsonResponse(res, true, status);
  }

  private getConfig(req: Request, res: Response): void {
    const config = configManager.config;
    this.jsonResponse(res, true, config);
  }

  private updateConfig(req: Request, res: Response): void {
    try {
      const newConfig: Partial<Config> = req.body;
      configManager.updateConfig(newConfig);
      this.jsonResponse(res, true, { message: 'Config updated successfully' });
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private updateStrategyConfig(req: Request, res: Response): void {
    try {
      const params: Partial<TradingStrategyParams> = req.body;
      configManager.updateStrategy(params);
      
      if (this.strategy && this.strategy.updateParams) {
        this.strategy.updateParams(params);
      }
      
      this.jsonResponse(res, true, { message: 'Strategy config updated successfully' });
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private updateFeesConfig(req: Request, res: Response): void {
    try {
      const params: Partial<FeeConfig> = req.body;
      configManager.updateFees(params);
      
      if (this.strategy && this.strategy.updateFees) {
        this.strategy.updateFees(params);
      }
      
      this.jsonResponse(res, true, { message: 'Fees config updated successfully' });
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private updateRuntimeConfig(req: Request, res: Response): void {
    try {
      const params: Partial<RuntimeConfig> = req.body;
      configManager.updateRuntime(params);
      
      this.emit('runtimeConfigChanged', params);
      
      this.jsonResponse(res, true, { message: 'Runtime config updated successfully' });
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private startTrading(req: Request, res: Response): void {
    try {
      if (this.tradingStatus.isRunning) {
        this.jsonResponse(res, false, undefined, 'Trading is already running');
        return;
      }

      this.emit('startTrading');
      this.setTradingStatus({ isRunning: true, startTime: Date.now() });
      
      this.jsonResponse(res, true, { message: 'Trading started successfully' });
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private stopTrading(req: Request, res: Response): void {
    try {
      if (!this.tradingStatus.isRunning) {
        this.jsonResponse(res, false, undefined, 'Trading is not running');
        return;
      }

      this.emit('stopTrading');
      this.setTradingStatus({ isRunning: false });
      
      this.jsonResponse(res, true, { message: 'Trading stopped successfully' });
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private getOpenPositions(req: Request, res: Response): void {
    try {
      if (!this.strategy) {
        this.jsonResponse(res, true, []);
        return;
      }

      const positions: Position[] = this.strategy.getOpenPositions() || [];
      this.jsonResponse(res, true, positions);
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private getClosedPositions(req: Request, res: Response): void {
    try {
      if (!this.strategy) {
        this.jsonResponse(res, true, []);
        return;
      }

      const positions: ClosedPosition[] = this.strategy.getClosedPositions() || [];
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const sortedPositions = positions.sort((a, b) => b.exitTimestamp - a.exitTimestamp).slice(0, limit);
      
      this.jsonResponse(res, true, sortedPositions);
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private getStatistics(req: Request, res: Response): void {
    try {
      let statistics: SessionStatistics | null = null;
      
      if (this.tradeManager && this.tradeManager.getCurrentSession) {
        const currentSession: TradingSession = this.tradeManager.getCurrentSession();
        if (currentSession && currentSession.statistics) {
          statistics = currentSession.statistics;
        }
      }

      this.jsonResponse(res, true, statistics);
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private getSessions(req: Request, res: Response): void {
    try {
      if (!this.tradeManager) {
        this.jsonResponse(res, true, []);
        return;
      }

      const sessions: string[] = this.tradeManager.listSessions() || [];
      this.jsonResponse(res, true, sessions);
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private getSessionDetails(req: Request, res: Response): void {
    try {
      const sessionId = req.params.sessionId;
      
      if (!this.tradeManager) {
        this.jsonResponse(res, false, undefined, 'Trade manager not available');
        return;
      }

      const session: TradingSession | null = this.tradeManager.loadSession(sessionId);
      
      if (!session) {
        this.jsonResponse(res, false, undefined, `Session not found: ${sessionId}`);
        return;
      }

      this.jsonResponse(res, true, session);
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  private getActiveTokens(req: Request, res: Response): void {
    try {
      if (!this.tokenManager) {
        this.jsonResponse(res, true, []);
        return;
      }

      const tokens = this.tokenManager.getAllTokens() || [];
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      
      const sortedTokens = tokens.sort((a: TokenData, b: TokenData) => b.volume30s - a.volume30s).slice(0, limit);
      
      this.jsonResponse(res, true, sortedTokens);
    } catch (error) {
      this.jsonResponse(res, false, undefined, (error as Error).message);
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        console.log('API Server is already running');
        resolve();
        return;
      }

      this.server = this.app.listen(this.config.port, this.config.host, () => {
        console.log(`\n${'='.repeat(60)}`);
        console.log('API SERVER STARTED');
        console.log(`${'='.repeat(60)}`);
        console.log(`Server running at: http://${this.config.host}:${this.config.port}`);
        console.log(`API endpoint: http://${this.config.host}:${this.config.port}/api`);
        console.log(`${'='.repeat(60)}\n`);
        resolve();
      });

      this.server.on('error', (error: Error) => {
        console.error('API Server error:', error);
        reject(error);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        console.log('API Server is not running');
        resolve();
        return;
      }

      this.server.close((error?: Error) => {
        if (error) {
          console.error('Error stopping API server:', error);
          reject(error);
        } else {
          console.log('API Server stopped');
          this.server = null;
          resolve();
        }
      });
    });
  }

  public isRunning(): boolean {
    return this.server !== null;
  }
}
