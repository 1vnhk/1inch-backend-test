import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GasPriceService } from './gas-price.service';

const toBigInt = (value: string) => BigInt(value);

const MOCK_STALENESS_MS = 20_000;

describe('GasPriceService', () => {
  let service: GasPriceService;

  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue(MOCK_STALENESS_MS),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new GasPriceService(mockConfigService);
  });

  it('throws when gas price cache is empty', () => {
    expect(() => service.getGasPrice()).toThrow(ServiceUnavailableException);
  });

  it('updates cache and returns tiered gas prices', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    service.updateGasPrice(100n, 1n);
    const result = service.getGasPrice();

    expect(result.baseFee).toBe('100');

    const priorityFees = [
      toBigInt(result.low.maxPriorityFeePerGas),
      toBigInt(result.medium.maxPriorityFeePerGas),
      toBigInt(result.high.maxPriorityFeePerGas),
      toBigInt(result.instant.maxPriorityFeePerGas),
    ];

    const maxFees = [
      toBigInt(result.low.maxFeePerGas),
      toBigInt(result.medium.maxFeePerGas),
      toBigInt(result.high.maxFeePerGas),
      toBigInt(result.instant.maxFeePerGas),
    ];

    expect(priorityFees[0] <= priorityFees[1]).toBe(true);
    expect(priorityFees[1] <= priorityFees[2]).toBe(true);
    expect(priorityFees[2] <= priorityFees[3]).toBe(true);

    expect(maxFees[0] <= maxFees[1]).toBe(true);
    expect(maxFees[1] <= maxFees[2]).toBe(true);
    expect(maxFees[2] <= maxFees[3]).toBe(true);

    nowSpy.mockRestore();
  });

  it('marks cache stale after threshold', () => {
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1_000);
    service.updateGasPrice(100n, 100n);

    // Just under threshold — not stale
    nowSpy.mockReturnValue(1_000 + MOCK_STALENESS_MS - 1);
    expect(service.isCacheStale()).toBe(false);

    // Just over threshold — stale
    nowSpy.mockReturnValue(1_000 + MOCK_STALENESS_MS + 1);
    expect(service.isCacheStale()).toBe(true);

    nowSpy.mockRestore();
  });
});
