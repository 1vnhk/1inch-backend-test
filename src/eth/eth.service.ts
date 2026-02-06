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
  private provider: ethers.providers.WebSocketProvider;
  private readonly logger = new Logger(EthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly gasPriceService: GasPriceService,
  ) {}

  onModuleInit() {
    this.provider = new ethers.providers.WebSocketProvider(
      this.configService.getOrThrow<string>('ETH_NODE_WS'),
    );

    this.logger.log('Subscribed to new Ethereum blocks via WebSocket');
    this.subscribeToNewHeads();
  }

  onModuleDestroy() {
    this.provider?.destroy();
  }

  public subscribeToNewHeads(): void {
    this.provider.on('block', (blockNumber: number) => {
      void this.fetchAndUpdateGasPrice(blockNumber).catch((error) => {
        this.logger.error(
          `Failed to update gas price for block ${blockNumber}`,
          error,
        );
      });
    });
  }

  private async fetchAndUpdateGasPrice(
    blockTag: number | 'latest',
  ): Promise<void> {
    const [block, priorityFeeHex] = await Promise.all([
      this.provider.getBlock(blockTag),
      this.provider.send('eth_maxPriorityFeePerGas', []) as Promise<string>,
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
}
