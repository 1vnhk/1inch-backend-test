import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { GasPriceService } from '../gas-price/gas-price.service';

@Injectable()
export class EthService implements OnModuleInit, OnModuleDestroy {
  private wsProvider: ethers.providers.WebSocketProvider;
  private readonly logger = new Logger(EthService.name);

  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly gasPriceService: GasPriceService,
  ) {}

  onModuleInit() {
    this.createWebSocketProvider();
  }

  onModuleDestroy() {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    void this.wsProvider?.destroy();
  }

  public subscribeToNewHeads(): void {
    this.wsProvider.on('block', (blockNumber: number) => {
      void this.fetchAndUpdateGasPrice(blockNumber).catch((error) => {
        this.logger.error(
          `Failed to update gas price for block ${blockNumber}`,
          error,
        );
      });
    });
  }

  isWebSocketConnected(): boolean {
    const rawSocket = (this.wsProvider as unknown as { _websocket?: WebSocket })
      ._websocket;
    return rawSocket?.readyState === 1;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  private async fetchAndUpdateGasPrice(
    blockTag: number | 'latest',
    provider: ethers.providers.WebSocketProvider = this.wsProvider,
  ): Promise<void> {
    const [block, priorityFeeHex] = await Promise.all([
      provider.getBlock(blockTag),
      provider.send('eth_maxPriorityFeePerGas', []) as Promise<string>,
    ]);

    if (!block.baseFeePerGas) {
      this.logger.warn(`Block ${blockTag} has no baseFeePerGas, skipping`);
      return;
    }

    this.gasPriceService.updateGasPrice(
      block.baseFeePerGas.toBigInt(),
      ethers.BigNumber.from(priorityFeeHex).toBigInt(),
    );
  }

  private createWebSocketProvider(): void {
    const wsUrl = this.configService.getOrThrow<string>('ETH_NODE_WS');
    this.wsProvider = new ethers.providers.WebSocketProvider(wsUrl);
    this.reconnectAttempts = 0;

    this.attachWebSocketHandlers();
    this.subscribeToNewHeads();
  }

  private attachWebSocketHandlers(): void {
    const rawSocket = (this.wsProvider as unknown as { _websocket?: WebSocket })
      ._websocket;
    if (!rawSocket) return;

    rawSocket.onclose = () => {
      this.logger.warn('WebSocket closed. Reconnecting...');
      this.scheduleReconnect();
    };
    rawSocket.onerror = () => {
      this.logger.warn('WebSocket error. Reconnecting...');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimer) return;

    const backoffMs = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.logger.log('Attempting WebSocket reconnect...');

      try {
        void this.wsProvider?.destroy();
      } catch (error) {
        this.logger.warn('Failed to destroy WebSocket provider', error);
      }

      this.createWebSocketProvider();
    }, backoffMs);
  }
}
