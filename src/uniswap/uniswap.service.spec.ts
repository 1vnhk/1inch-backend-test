import { Test, TestingModule } from '@nestjs/testing';
import { UniswapService } from './uniswap.service';
import { EthService } from '../eth/eth.service';
import { ethers } from 'ethers';

// Stable mock for Contract — must be declared before any usage
const mockGetReserves = jest.fn();
const mockOn = jest.fn();
const mockRemoveAllListeners = jest.fn();

jest.mock('ethers', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const actual = jest.requireActual('ethers');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    ethers: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      ...actual.ethers,
      Contract: jest.fn().mockImplementation(() => ({
        getReserves: mockGetReserves,
        on: mockOn,
        removeAllListeners: mockRemoveAllListeners,
      })),
    },
  };
});

describe('UniswapService', () => {
  let service: UniswapService;

  const mockProvider = {} as ethers.providers.WebSocketProvider;

  const mockEthService = {
    getProvider: jest.fn().mockReturnValue(mockProvider),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEthService.getProvider.mockReturnValue(mockProvider);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UniswapService,
        {
          provide: EthService,
          useValue: mockEthService,
        },
      ],
    }).compile();

    service = module.get<UniswapService>(UniswapService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computePairAddress', () => {
    it('should compute correct pair address for WETH/USDC', () => {
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      // Expected pair address (verified on Etherscan)
      const expectedPairAddress = '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc';

      const pairAddress = service.computePairAddress(WETH, USDC);

      expect(pairAddress.toLowerCase()).toBe(expectedPairAddress.toLowerCase());
    });

    it('should compute same address regardless of token order', () => {
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      const pairAddress1 = service.computePairAddress(WETH, USDC);
      const pairAddress2 = service.computePairAddress(USDC, WETH);

      expect(pairAddress1).toBe(pairAddress2);
    });

    it('should throw for identical addresses', () => {
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

      expect(() => service.computePairAddress(WETH, WETH)).toThrow(
        'IDENTICAL_ADDRESSES',
      );
    });

    it('should compute correct pair address for WETH/DAI', () => {
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

      // Expected pair address (verified on Etherscan)
      const expectedPairAddress = '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11';

      const pairAddress = service.computePairAddress(WETH, DAI);

      expect(pairAddress.toLowerCase()).toBe(expectedPairAddress.toLowerCase());
    });
  });

  describe('getAmountOut calculation', () => {
    const getAmountOut = (
      amountIn: bigint,
      reserveIn: bigint,
      reserveOut: bigint,
    ): bigint => {
      if (amountIn <= 0n) throw new Error('INSUFFICIENT_INPUT_AMOUNT');
      if (reserveIn <= 0n || reserveOut <= 0n)
        throw new Error('INSUFFICIENT_LIQUIDITY');

      const amountInWithFee = amountIn * 997n;
      const numerator = amountInWithFee * reserveOut;
      const denominator = reserveIn * 1000n + amountInWithFee;

      return numerator / denominator;
    };

    it('should match Uniswap formula exactly', () => {
      const amountIn = 1000n;
      const reserveIn = 10000n;
      const reserveOut = 10000n;

      // Manual calculation:
      // amountInWithFee = 1000 * 997 = 997000
      // numerator = 997000 * 10000 = 9970000000
      // denominator = 10000 * 1000 + 997000 = 10997000
      // amountOut = 9970000000 / 10997000 = 906

      const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
      expect(amountOut).toBe(906n);
    });

    it('should calculate correct output for 1 ETH swap', () => {
      const amountIn = BigInt('1000000000000000000'); // 1 ETH
      const reserveIn = BigInt('100000000000000000000'); // 100 ETH
      const reserveOut = BigInt('200000000000'); // 200,000 USDC

      const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);

      // ~1970 USDC (accounting for 0.3% fee and price impact)
      expect(amountOut).toBeGreaterThan(0n);
      expect(amountOut).toBeLessThan(reserveOut);
    });

    it('should throw for zero input amount', () => {
      expect(() => getAmountOut(0n, 100n, 100n)).toThrow(
        'INSUFFICIENT_INPUT_AMOUNT',
      );
    });

    it('should throw for zero reserves', () => {
      expect(() => getAmountOut(1n, 0n, 100n)).toThrow(
        'INSUFFICIENT_LIQUIDITY',
      );
      expect(() => getAmountOut(1n, 100n, 0n)).toThrow(
        'INSUFFICIENT_LIQUIDITY',
      );
    });

    it('should handle large numbers (uint256 range)', () => {
      const largeAmount = BigInt('1000000000000000000000000');
      const largeReserveIn = BigInt('10000000000000000000000000');
      const largeReserveOut = BigInt('20000000000000000000000000');

      const amountOut = getAmountOut(
        largeAmount,
        largeReserveIn,
        largeReserveOut,
      );

      expect(amountOut).toBeGreaterThan(0n);
    });
  });

  describe('getReturnAmount', () => {
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

    const mockReserves = () => {
      mockGetReserves.mockResolvedValue([
        ethers.BigNumber.from('100000000000000000000'), // 100 ETH
        ethers.BigNumber.from('200000000000'), // 200,000 USDC
        0,
      ]);
    };

    it('should fetch reserves and return amountOut on first call', async () => {
      mockReserves();

      const result = await service.getReturnAmount(
        WETH,
        USDC,
        '1000000000000000000',
      );

      expect(result).toBeGreaterThan(0n);
      expect(mockGetReserves).toHaveBeenCalledTimes(1);
      expect(mockOn).toHaveBeenCalledWith('Sync', expect.any(Function));
    });

    it('should serve subsequent calls from cache without RPC', async () => {
      mockReserves();

      await service.getReturnAmount(WETH, USDC, '1000000000000000000');
      await service.getReturnAmount(WETH, USDC, '2000000000000000000');

      expect(mockGetReserves).toHaveBeenCalledTimes(1);
    });

    it('should coalesce concurrent fetches for the same pair', async () => {
      // Use a deferred promise to control when getReserves resolves
      let resolveGetReserves!: (value: unknown) => void;
      mockGetReserves.mockReturnValue(
        new Promise((resolve) => {
          resolveGetReserves = resolve;
        }),
      );

      // Fire two concurrent requests for the same pair
      const promise1 = service.getReturnAmount(
        WETH,
        USDC,
        '1000000000000000000',
      );
      const promise2 = service.getReturnAmount(
        WETH,
        USDC,
        '2000000000000000000',
      );

      // Resolve the single RPC call
      resolveGetReserves([
        ethers.BigNumber.from('100000000000000000000'),
        ethers.BigNumber.from('200000000000'),
        0,
      ]);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Only one RPC call, one subscription
      expect(mockGetReserves).toHaveBeenCalledTimes(1);
      expect(mockOn).toHaveBeenCalledTimes(1);

      // Both return valid (different) amounts
      expect(result1).toBeGreaterThan(0n);
      expect(result2).toBeGreaterThan(result1);
    });

    it('should not duplicate Sync subscription on concurrent requests', async () => {
      let resolveGetReserves!: (value: unknown) => void;
      mockGetReserves.mockReturnValue(
        new Promise((resolve) => {
          resolveGetReserves = resolve;
        }),
      );

      const p1 = service.getReturnAmount(WETH, USDC, '1000000000000000000');
      const p2 = service.getReturnAmount(WETH, USDC, '1000000000000000000');
      const p3 = service.getReturnAmount(WETH, USDC, '1000000000000000000');

      resolveGetReserves([
        ethers.BigNumber.from('100000000000000000000'),
        ethers.BigNumber.from('200000000000'),
        0,
      ]);

      await Promise.all([p1, p2, p3]);

      // Exactly one Sync listener despite three concurrent callers
      expect(mockOn).toHaveBeenCalledTimes(1);
      expect(mockOn).toHaveBeenCalledWith('Sync', expect.any(Function));
    });

    it('should throw when provider is not available', async () => {
      mockEthService.getProvider.mockReturnValue(null);

      await expect(
        service.getReturnAmount(WETH, USDC, '1000000000000000000'),
      ).rejects.toThrow('WebSocket provider not available');
    });

    it('should allow a new fetch after a failed one', async () => {
      // First call fails
      mockGetReserves.mockRejectedValueOnce(new Error('RPC error'));

      await expect(
        service.getReturnAmount(WETH, USDC, '1000000000000000000'),
      ).rejects.toThrow('RPC error');

      // Second call succeeds — pendingFetches entry was cleaned up by .finally()
      mockReserves();

      const result = await service.getReturnAmount(
        WETH,
        USDC,
        '1000000000000000000',
      );

      expect(result).toBeGreaterThan(0n);
      expect(mockGetReserves).toHaveBeenCalledTimes(2);
    });
  });
});
