import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocketProvider } from 'ethers';
import { GasPriceService } from '../gas-price/gas-price.service';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

@Injectable()
export class EthService implements OnModuleInit, OnModuleDestroy {
  private provider: WebSocketProvider | undefined;
  private readonly logger = new Logger(EthService.name);
  private readonly reconnectListeners = new Set<() => void>();

  private isShuttingDown = false;
  private isReconnecting = false;
  private reconnectAttempts = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly gasPriceService: GasPriceService,
  ) {}

  onModuleInit() {
    this.connect();
  }

  async onModuleDestroy() {
    this.isShuttingDown = true;
    this.reconnectListeners.clear();

    try {
      await this.provider?.destroy();
    } catch (error) {
      this.logger.warn('Error destroying provider on shutdown', error);
    }

    this.provider = undefined;
  }

  /**
   * Register a listener for provider reconnect events.
   * Returns an unsubscribe function.
   */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
  }

  /**
   * Get the WebSocket provider for creating contract instances.
   * Returns undefined before initialization or during reconnect.
   */
  getProvider(): WebSocketProvider | undefined {
    return this.provider;
  }

  private connect() {
    const wsUrl = this.configService.getOrThrow<string>('ETH_NODE_WS');

    this.provider = new WebSocketProvider(wsUrl);

    this.setupEventListeners();
    this.logger.log('WebSocket Provider connected');
  }

  private setupEventListeners() {
    // Ethers v6 .on() returns Promise<Provider> — catch setup failures
    this.provider!.on('block', (blockNumber: number) => {
      // Successful block = connection is healthy — reset backoff
      this.reconnectAttempts = 0;

      this.fetchAndUpdateGasPrice(blockNumber).catch((error) => {
        this.logger.error(
          `Failed to update gas for block ${blockNumber}`,
          error,
        );
      });
    }).catch((error) => {
      this.logger.error('Failed to subscribe to block events', error);
    });

    this.provider!.on('error', (error) => {
      this.logger.error('WebSocket error:', error);
      this.handleReconnect();
    }).catch((error) => {
      this.logger.error('Failed to subscribe to error events', error);
    });
  }

  private handleReconnect() {
    if (this.isShuttingDown || this.isReconnecting) return;
    this.isReconnecting = true;

    const backoffMs = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** this.reconnectAttempts,
    );
    this.reconnectAttempts += 1;

    this.logger.warn(
      `Reconnecting in ${backoffMs}ms (attempt ${this.reconnectAttempts})...`,
    );

    // Destroy the dead provider, then schedule reconnect
    const oldProvider = this.provider;
    this.provider = undefined;

    const destroyAndReconnect = async () => {
      try {
        await oldProvider?.destroy();
      } catch (error) {
        this.logger.warn('Error destroying old provider', error);
      }

      setTimeout(() => {
        this.isReconnecting = false;

        if (this.isShuttingDown) return;

        this.connect();

        for (const listener of this.reconnectListeners) {
          try {
            listener();
          } catch (error) {
            this.logger.error('Reconnect listener threw', error);
          }
        }
      }, backoffMs);
    };

    destroyAndReconnect().catch((error) => {
      this.isReconnecting = false;
      this.logger.error('Reconnect failed unexpectedly', error);
    });
  }

  private async fetchAndUpdateGasPrice(blockNumber: number): Promise<void> {
    const provider = this.provider;
    if (!provider) return;

    const [block, priorityFee] = await Promise.all([
      provider.getBlock(blockNumber),
      provider.send('eth_maxPriorityFeePerGas', []) as Promise<string>,
    ]);

    if (block && block.baseFeePerGas) {
      this.gasPriceService.updateGasPrice(
        block.baseFeePerGas,
        BigInt(priorityFee),
      );
    }
  }
}
