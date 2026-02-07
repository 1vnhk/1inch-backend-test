import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GasPriceResponse, GasPriceTier } from './types';

interface GasPriceCache {
  data: GasPriceResponse;
  updatedAt: number;
}

const MIN_PRIORITY_FEE = 1_500_000_000n; // 1.5 Gwei

// NOTE: I am not sure how to properly calculate the tiers. I've come up with my own ratios.
// pMult (priority fee) that goes to validator
// baseBuffer (safety margin to get included into the block)
const TIERS = {
  low: { pMult: 100n, pDiv: 100n, baseBuffer: 110n }, // 1.0x Tip, 1.1x BaseFee
  medium: { pMult: 120n, pDiv: 100n, baseBuffer: 125n }, // 1.2x Tip, 1.25x BaseFee
  high: { pMult: 150n, pDiv: 100n, baseBuffer: 150n }, // 1.5x Tip, 1.5x BaseFee
  instant: { pMult: 200n, pDiv: 100n, baseBuffer: 200n }, // 2.0x Tip, 2.0x BaseFee
} as const;

@Injectable()
export class GasPriceService {
  private readonly logger = new Logger(GasPriceService.name);
  private readonly stalenessMs: number;
  private cache: GasPriceCache | null = null;

  constructor(private readonly configService: ConfigService) {
    this.stalenessMs = this.configService.getOrThrow<number>(
      'GAS_PRICE_STALENESS_MS',
    );
  }

  getGasPrice(): GasPriceResponse {
    if (!this.cache) {
      throw new ServiceUnavailableException(
        'Gas price data not yet available. Waiting for first block.',
      );
    }

    if (this.isCacheStale()) {
      this.logger.warn(
        `Gas price cache is stale (age: ${Date.now() - this.cache.updatedAt}ms)`,
      );
    }

    return this.cache.data;
  }

  updateGasPrice(baseFee: bigint, suggestedPriorityFee: bigint): void {
    // NOTE: I ran into an issue wheer the returned data was identical for all tiers. Which is not correct (to say the least)
    // If node returns a tiny suggested fee (common on testnets/empty blocks),
    // ensure we start calculation from a healthy minimum.
    const anchorPriorityFee =
      suggestedPriorityFee > MIN_PRIORITY_FEE
        ? suggestedPriorityFee
        : MIN_PRIORITY_FEE;

    this.cache = {
      data: {
        baseFee: baseFee.toString(),
        low: this.calculateTier(baseFee, anchorPriorityFee, TIERS.low),
        medium: this.calculateTier(baseFee, anchorPriorityFee, TIERS.medium),
        high: this.calculateTier(baseFee, anchorPriorityFee, TIERS.high),
        instant: this.calculateTier(baseFee, anchorPriorityFee, TIERS.instant),
      },
      updatedAt: Date.now(),
    };

    this.logger.log(
      `Gas updated. Base: ${baseFee}, AnchorTip: ${anchorPriorityFee}`,
    );
  }

  isCacheStale(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.updatedAt > this.stalenessMs;
  }

  getLastUpdateTimestamp(): number | undefined {
    return this.cache?.updatedAt;
  }

  private calculateTier(
    baseFee: bigint,
    priorityFeeBase: bigint,
    options: { pMult: bigint; pDiv: bigint; baseBuffer: bigint },
  ): GasPriceTier {
    // 1. Calculate Priority Fee (Tip)
    const priorityFee = (priorityFeeBase * options.pMult) / options.pDiv;

    // 2. Calculate Max Fee (BaseFee * Buffer + Tip)
    // We buffer the baseFee to ensure tx works for the next few blocks even if price spikes
    const bufferedBaseFee = (baseFee * options.baseBuffer) / 100n;
    const maxFeePerGas = bufferedBaseFee + priorityFee;

    return {
      maxPriorityFeePerGas: priorityFee.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
    };
  }
}
