import { ethers } from 'ethers';
import { Logger } from '@nestjs/common';
import { EthService } from './eth.service';
import { GasPriceService } from '../gas-price/gas-price.service';

jest.mock('ethers', () => ({
  ethers: {
    providers: { WebSocketProvider: jest.fn() },
    BigNumber: { from: jest.fn() },
  },
}));

const MockWSProvider = ethers.providers
  .WebSocketProvider as unknown as jest.Mock;
// eslint-disable-next-line @typescript-eslint/unbound-method
const mockBigNumberFrom = ethers.BigNumber.from as unknown as jest.Mock;

const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

describe('EthService', () => {
  let service: EthService;
  let updateGasPriceSpy: jest.SpyInstance;
  let subscribeSpy: jest.SpyInstance;

  let blockHandler: ((n: number) => void) | undefined;
  let wsHandlers: { onclose?: () => void; onerror?: () => void };
  let mockGetBlock: jest.Mock;
  let mockSend: jest.Mock;
  let mockDestroy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    blockHandler = undefined;
    wsHandlers = {};
    mockGetBlock = jest.fn();
    mockSend = jest.fn();
    mockDestroy = jest.fn();

    MockWSProvider.mockImplementation(() => ({
      on: jest.fn((event: string, handler: (n: number) => void) => {
        if (event === 'block') blockHandler = handler;
      }),
      getBlock: mockGetBlock,
      send: mockSend,
      destroy: mockDestroy,
      _websocket: wsHandlers,
    }));

    const configService = {
      getOrThrow: jest.fn().mockReturnValue('wss://example'),
    };
    const gasPriceService = {
      updateGasPrice: jest.fn(),
    } as unknown as GasPriceService;

    service = new EthService(configService as never, gasPriceService);
    updateGasPriceSpy = jest.spyOn(gasPriceService, 'updateGasPrice');
    subscribeSpy = jest.spyOn(service, 'subscribeToNewHeads');
  });

  it('creates WS provider and subscribes to new heads on init', () => {
    service.onModuleInit();

    expect(MockWSProvider).toHaveBeenCalledWith('wss://example');
    expect(subscribeSpy).toHaveBeenCalled();
    expect(blockHandler).toBeDefined();
  });

  it('fetches and updates gas price when a new block arrives', async () => {
    mockGetBlock.mockResolvedValue({
      baseFeePerGas: { toBigInt: () => 100n },
    });
    mockSend.mockResolvedValue('0x10');
    mockBigNumberFrom.mockReturnValue({ toBigInt: () => 16n });

    service.onModuleInit();
    blockHandler?.(123);
    await flushPromises();

    expect(mockGetBlock).toHaveBeenCalledWith(123);
    expect(mockSend).toHaveBeenCalledWith('eth_maxPriorityFeePerGas', []);
    expect(updateGasPriceSpy).toHaveBeenCalledWith(100n, 16n);
  });

  it('skips update when baseFeePerGas is missing', async () => {
    mockGetBlock.mockResolvedValue({ baseFeePerGas: null });
    mockSend.mockResolvedValue('0x10');

    service.onModuleInit();
    blockHandler?.(456);
    await flushPromises();

    expect(updateGasPriceSpy).not.toHaveBeenCalled();
  });

  it('destroys provider on module destroy', () => {
    service.onModuleInit();
    service.onModuleDestroy();

    expect(mockDestroy).toHaveBeenCalled();
  });

  it('reconnects with backoff on websocket close', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    service.onModuleInit();
    expect(wsHandlers.onclose).toBeDefined();

    wsHandlers.onclose?.();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);

    jest.runAllTimers();

    expect(mockDestroy).toHaveBeenCalled();
    expect(MockWSProvider).toHaveBeenCalledTimes(2);

    setTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });

  it('reconnects with backoff on websocket error', () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    service.onModuleInit();
    expect(wsHandlers.onerror).toBeDefined();

    wsHandlers.onerror?.();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);

    jest.runAllTimers();

    expect(mockDestroy).toHaveBeenCalled();
    expect(MockWSProvider).toHaveBeenCalledTimes(2);

    setTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });

  it('calls reconnect listener after websocket reconnects', () => {
    jest.useFakeTimers();

    service.onModuleInit();

    const reconnectHandler = jest.fn();
    service.onReconnect(reconnectHandler);

    // Trigger reconnect
    wsHandlers.onclose?.();
    jest.runAllTimers();

    expect(reconnectHandler).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('does not call reconnect listener on initial connection', () => {
    const reconnectHandler = jest.fn();
    service.onReconnect(reconnectHandler);

    service.onModuleInit();

    expect(reconnectHandler).not.toHaveBeenCalled();
  });

  it('removes listener via returned unsubscribe function', () => {
    jest.useFakeTimers();

    service.onModuleInit();

    const reconnectHandler = jest.fn();
    const unsubscribe = service.onReconnect(reconnectHandler);

    unsubscribe();

    wsHandlers.onclose?.();
    jest.runAllTimers();

    expect(reconnectHandler).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('clears all listeners on module destroy', () => {
    jest.useFakeTimers();

    service.onModuleInit();

    const reconnectHandler = jest.fn();
    service.onReconnect(reconnectHandler);

    service.onModuleDestroy();

    // Re-init to get a new provider that can trigger close
    service.onModuleInit();
    wsHandlers.onclose?.();
    jest.runAllTimers();

    expect(reconnectHandler).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});
