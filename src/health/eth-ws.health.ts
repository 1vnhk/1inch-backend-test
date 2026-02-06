import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GasPriceService } from '../gas-price/gas-price.service';

@Injectable()
export class EthWsHealthIndicator extends HealthIndicator {
  private readonly APP_START_TIME = Date.now();

  constructor(
    private readonly configService: ConfigService,
    private readonly gasPriceService: GasPriceService,
  ) {
    super();
  }

  isHealthy(key = 'eth_ws'): HealthIndicatorResult {
    const lastUpdate = this.gasPriceService.getLastUpdateTimestamp() ?? 0;
    const isStale = this.gasPriceService.isCacheStale();
    const timeSinceStart = Date.now() - this.APP_START_TIME;

    const isHealthy =
      !isStale ||
      timeSinceStart < this.configService.getOrThrow<number>('GRACE_PERIOD_MS');

    const result = this.getStatus(key, isHealthy, {
      lastUpdate: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : 'never',
      secondsSinceLastUpdate:
        lastUpdate > 0 ? Math.floor((Date.now() - lastUpdate) / 1000) : null,
    });

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError(
      'Ethereum WebSocket is stale or disconnected',
      result,
    );
  }
}
