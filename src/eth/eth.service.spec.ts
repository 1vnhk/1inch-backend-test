import { WebSocketProvider } from 'ethers';
import { Logger } from '@nestjs/common';
import { EthService } from './eth.service';
import { GasPriceService } from '../gas-price/gas-price.service';

jest.mock('ethers', () => ({
  WebSocketProvider: jest.fn(),
}));

const MockWSProvider = WebSocketProvider as unknown as jest.Mock;

const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// Suppress NestJS Logger output entirely — prevents stray logs from
// lingering microtasks that resolve after Jest restores mocks.
beforeAll(() => {
  Logger.overrideLogger(false);
});
afterAll(() => {
  Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);
});

describe('EthService', () => {
  let service: EthService;
  let gasPriceService: GasPriceService;
  let updateGasPriceSpy: jest.SpyInstance;

  let eventHandlers: Record<string, (...args: unknown[]) => unknown>;
  let mockGetBlock: jest.Mock;
  let mockSend: jest.Mock;
  let mockDestroy: jest.Mock;
  let mockOn: jest.Mock;

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    eventHandlers = {};
    mockGetBlock = jest.fn();
    mockSend = jest.fn();
    mockDestroy = jest.fn().mockResolvedValue(undefined);
    mockOn = jest.fn(
      (event: string, handler: (...args: unknown[]) => unknown) => {
        eventHandlers[event] = handler;
        return Promise.resolve(); // ethers v6 .on() returns Promise
      },
    );

    MockWSProvider.mockImplementation(() => ({
      on: mockOn,
      getBlock: mockGetBlock,
      send: mockSend,
      destroy: mockDestroy,
    }));

    const configService = {
      getOrThrow: jest.fn().mockReturnValue('wss://example'),
    };
    gasPriceService = {
      updateGasPrice: jest.fn(),
    } as unknown as GasPriceService;

    service = new EthService(configService as never, gasPriceService);
    updateGasPriceSpy = jest.spyOn(gasPriceService, 'updateGasPrice');
  });

  it('creates WebSocketProvider and registers event listeners on init', () => {
    service.onModuleInit();

    expect(MockWSProvider).toHaveBeenCalledWith('wss://example');
    expect(mockOn).toHaveBeenCalledWith('block', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('fetches and updates gas price when a new block arrives', async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: 100n });
    mockSend.mockResolvedValue('0x10');

    service.onModuleInit();
    eventHandlers['block'](123);
    await flushMicrotasks();

    expect(mockGetBlock).toHaveBeenCalledWith(123);
    expect(mockSend).toHaveBeenCalledWith('eth_maxPriorityFeePerGas', []);
    expect(updateGasPriceSpy).toHaveBeenCalledWith(100n, BigInt('0x10'));
  });

  it('skips update when block is null', async () => {
    mockGetBlock.mockResolvedValue(null);
    mockSend.mockResolvedValue('0x10');

    service.onModuleInit();
    eventHandlers['block'](456);
    await flushMicrotasks();

    expect(updateGasPriceSpy).not.toHaveBeenCalled();
  });

  it('skips update when baseFeePerGas is missing', async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: null });
    mockSend.mockResolvedValue('0x10');

    service.onModuleInit();
    eventHandlers['block'](456);
    await flushMicrotasks();

    expect(updateGasPriceSpy).not.toHaveBeenCalled();
  });

  it('skips update when provider is undefined (during reconnect)', async () => {
    service.onModuleInit();

    // Simulate provider being cleared during reconnect
    eventHandlers['error'](new Error('socket died'));
    await flushMicrotasks();

    // Provider is now undefined — block handler should bail
    mockGetBlock.mockClear();
    eventHandlers['block'](999);
    await flushMicrotasks();

    expect(mockGetBlock).not.toHaveBeenCalled();
    expect(updateGasPriceSpy).not.toHaveBeenCalled();
  });

  it('logs error when fetchAndUpdateGasPrice throws', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error');
    mockGetBlock.mockRejectedValue(new Error('rpc failure'));

    service.onModuleInit();
    eventHandlers['block'](789);
    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('789'),
      expect.any(Error),
    );
    expect(updateGasPriceSpy).not.toHaveBeenCalled();
  });

  it('destroys provider on module destroy', async () => {
    service.onModuleInit();
    await service.onModuleDestroy();

    expect(mockDestroy).toHaveBeenCalled();
  });

  it('nullifies provider on module destroy', async () => {
    service.onModuleInit();
    expect(service.getProvider()).toBeDefined();

    await service.onModuleDestroy();

    expect(service.getProvider()).toBeUndefined();
  });

  describe('reconnect', () => {
    it('reconnects after error event with exponential backoff', async () => {
      jest.useFakeTimers();

      service.onModuleInit();
      expect(eventHandlers['error']).toBeDefined();

      // First error — backoff should be 1s (1000 * 2^0)
      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();

      expect(mockDestroy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(MockWSProvider).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('increases backoff on successive failures', async () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      service.onModuleInit();

      // First reconnect — 1s backoff
      eventHandlers['error'](new Error('die'));
      await flushMicrotasks();

      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(MockWSProvider).toHaveBeenCalledTimes(2);

      // Second reconnect — 2s backoff
      eventHandlers['error'](new Error('die again'));
      await flushMicrotasks();

      // Should have scheduled with 2000ms
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(
        expect.any(Function),
        2_000,
      );

      jest.advanceTimersByTime(2_000);
      await flushMicrotasks();

      expect(MockWSProvider).toHaveBeenCalledTimes(3);

      setTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });

    it('resets backoff after a successful block event', async () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      mockGetBlock.mockResolvedValue({ baseFeePerGas: 100n });
      mockSend.mockResolvedValue('0x10');

      service.onModuleInit();

      // Trigger 3 reconnects to build up backoff (1s, 2s, 4s)
      eventHandlers['error'](new Error('die'));
      await flushMicrotasks();
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      eventHandlers['error'](new Error('die'));
      await flushMicrotasks();
      jest.advanceTimersByTime(2_000);
      await flushMicrotasks();

      eventHandlers['error'](new Error('die'));
      await flushMicrotasks();
      jest.advanceTimersByTime(4_000);
      await flushMicrotasks();

      // Now a block arrives — proves connection is healthy, resets backoff
      eventHandlers['block'](1234);
      await flushMicrotasks();

      // Next error should use 1s backoff (reset)
      eventHandlers['error'](new Error('die'));
      await flushMicrotasks();

      expect(setTimeoutSpy).toHaveBeenLastCalledWith(
        expect.any(Function),
        1_000,
      );

      setTimeoutSpy.mockRestore();
      jest.useRealTimers();
    });

    it('guards against concurrent reconnects', async () => {
      jest.useFakeTimers();

      service.onModuleInit();

      // Fire multiple error events rapidly
      eventHandlers['error'](new Error('error 1'));
      eventHandlers['error'](new Error('error 2'));
      eventHandlers['error'](new Error('error 3'));
      await flushMicrotasks();

      // Only one destroy should have happened
      expect(mockDestroy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      // Only one new provider created
      expect(MockWSProvider).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('does not reconnect when shutting down', async () => {
      jest.useFakeTimers();

      service.onModuleInit();
      await service.onModuleDestroy();

      MockWSProvider.mockClear();

      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();

      jest.advanceTimersByTime(30_000);
      await flushMicrotasks();

      expect(MockWSProvider).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('handles destroy() failure gracefully during reconnect', async () => {
      jest.useFakeTimers();

      mockDestroy.mockRejectedValueOnce(new Error('destroy failed'));

      service.onModuleInit();
      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();

      // Should still schedule reconnect despite destroy failure
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(MockWSProvider).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('nullifies provider immediately on reconnect', () => {
      service.onModuleInit();
      expect(service.getProvider()).toBeDefined();

      eventHandlers['error'](new Error('socket died'));

      // Provider should be undefined immediately (before backoff timer)
      expect(service.getProvider()).toBeUndefined();
    });
  });

  describe('onReconnect listeners', () => {
    it('calls reconnect listeners after successful reconnect', async () => {
      jest.useFakeTimers();

      service.onModuleInit();

      const listener = jest.fn();
      service.onReconnect(listener);

      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();

      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(listener).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('does not call listeners on initial connection', () => {
      const listener = jest.fn();
      service.onReconnect(listener);

      service.onModuleInit();

      expect(listener).not.toHaveBeenCalled();
    });

    it('removes listener via returned unsubscribe function', async () => {
      jest.useFakeTimers();

      service.onModuleInit();

      const listener = jest.fn();
      const unsubscribe = service.onReconnect(listener);

      unsubscribe();

      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(listener).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('clears all listeners on module destroy', async () => {
      jest.useFakeTimers();

      service.onModuleInit();

      const listener = jest.fn();
      service.onReconnect(listener);

      await service.onModuleDestroy();

      // Re-init to trigger reconnect scenario
      service.onModuleInit();
      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(listener).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('continues reconnecting even if a listener throws', async () => {
      jest.useFakeTimers();

      service.onModuleInit();

      const badListener = jest.fn(() => {
        throw new Error('listener exploded');
      });
      const goodListener = jest.fn();

      service.onReconnect(badListener);
      service.onReconnect(goodListener);

      eventHandlers['error'](new Error('socket died'));
      await flushMicrotasks();
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  it('returns the provider via getProvider()', () => {
    service.onModuleInit();

    const provider = service.getProvider();

    expect(provider).toBeDefined();
    expect(typeof provider!.on).toBe('function');
  });
});
