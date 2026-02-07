/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ethers } from 'ethers';
import { AppModule } from './../src/app.module';
import { EthService } from './../src/eth/eth.service';
import { GasPriceService } from './../src/gas-price/gas-price.service';

// Mock ethers.Contract to avoid real RPC calls in uniswap flow
const mockGetReserves = jest.fn();
const mockOn = jest.fn();
const mockRemoveAllListeners = jest.fn();

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: jest.fn().mockImplementation(() => ({
        getReserves: mockGetReserves,
        on: mockOn,
        removeAllListeners: mockRemoveAllListeners,
      })),
    },
  };
});

describe('API (e2e)', () => {
  let app: NestFastifyApplication;
  let gasPriceService: GasPriceService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EthService)
      .useValue({
        getProvider: jest.fn().mockReturnValue({}),
        subscribeToNewHeads: jest.fn(),
        isWebSocketConnected: jest.fn().mockReturnValue(true),
        getReconnectAttempts: jest.fn().mockReturnValue(0),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    gasPriceService = app.get(GasPriceService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /', () => {
    it('should return 200', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /health', () => {
    it('should return 200 with health indicators', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);

      const body = res.json();
      expect(body).toHaveProperty('status', 'ok');

      const info = body.info as Record<string, unknown>;
      expect(info).toHaveProperty('memory_heap');
      expect(info).toHaveProperty('eth_ws');
    });
  });

  describe('GET /gasPrice/:chainId', () => {
    it('should return 503 when cache is empty (no blocks received yet)', async () => {
      const res = await app.inject({ method: 'GET', url: '/gasPrice/1' });
      expect(res.statusCode).toBe(503);
    });

    it('should return 422 for unsupported chain', async () => {
      const res = await app.inject({ method: 'GET', url: '/gasPrice/137' });
      expect(res.statusCode).toBe(422);

      const body = res.json();
      expect(body.message).toContain('not supported');
    });

    it('should return 400 for non-integer chain ID', async () => {
      const res = await app.inject({ method: 'GET', url: '/gasPrice/abc' });
      expect(res.statusCode).toBe(400);
    });

    describe('with seeded cache', () => {
      beforeAll(() => {
        gasPriceService.updateGasPrice(
          20_000_000_000n, // 20 Gwei base fee
          2_000_000_000n, // 2 Gwei priority fee
        );
      });

      it('should return 200 with tiered EIP-1559 gas prices', async () => {
        const res = await app.inject({ method: 'GET', url: '/gasPrice/1' });
        expect(res.statusCode).toBe(200);

        const body = res.json();
        expect(body).toHaveProperty('baseFee', '20000000000');

        for (const tier of ['low', 'medium', 'high', 'instant']) {
          const t = body[tier] as Record<string, string>;
          expect(t).toHaveProperty('maxPriorityFeePerGas');
          expect(t).toHaveProperty('maxFeePerGas');
        }
      });

      it('should have tiers ordered low < medium < high < instant', async () => {
        const res = await app.inject({ method: 'GET', url: '/gasPrice/1' });
        const body = res.json();

        const tiers = ['low', 'medium', 'high', 'instant'];
        for (let i = 0; i < tiers.length - 1; i++) {
          expect(BigInt(body[tiers[i]].maxFeePerGas)).toBeLessThanOrEqual(
            BigInt(body[tiers[i + 1]].maxFeePerGas),
          );
          expect(
            BigInt(body[tiers[i]].maxPriorityFeePerGas),
          ).toBeLessThanOrEqual(
            BigInt(body[tiers[i + 1]].maxPriorityFeePerGas),
          );
        }
      });

      it('should include Cache-Control header', async () => {
        const res = await app.inject({ method: 'GET', url: '/gasPrice/1' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['cache-control']).toBe(
          'public, s-maxage=5, stale-while-revalidate=10',
        );
      });
    });
  });

  describe('GET /return/:fromToken/:toToken/:amountIn', () => {
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

    describe('successful swap', () => {
      it('should return amountOut for WETH -> USDC', async () => {
        mockGetReserves.mockResolvedValue([
          ethers.BigNumber.from('100000000000000000000'), // 100 ETH
          ethers.BigNumber.from('200000000000'), // 200k USDC
          0,
        ]);

        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${USDC}/1000000000000000000`,
        });

        expect(res.statusCode).toBe(200);
        const { amountOut } = res.json();
        expect(typeof amountOut).toBe('string');
        expect(BigInt(amountOut)).toBeGreaterThan(0n);
      });

      it('should serve subsequent requests from cache (no extra RPC)', async () => {
        mockGetReserves.mockClear();

        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${USDC}/2000000000000000000`,
        });

        expect(res.statusCode).toBe(200);
        expect(mockGetReserves).not.toHaveBeenCalled();
      });

      it('should handle uint256-range amounts', async () => {
        mockGetReserves.mockResolvedValue([
          ethers.BigNumber.from('50000000000000000000000'),
          ethers.BigNumber.from('100000000000000000000000'),
          0,
        ]);

        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${DAI}/123456789012345678901234567890`,
        });

        expect(res.statusCode).toBe(200);
        const { amountOut } = res.json();
        expect(typeof amountOut).toBe('string');
        expect(BigInt(amountOut)).toBeGreaterThan(0n);
      });
    });

    describe('input validation', () => {
      it('should return 400 for invalid fromTokenAddress', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/return/0xinvalid/${USDC}/1000000000000000000`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          message: 'Invalid fromTokenAddress',
        });
      });

      it('should return 400 for invalid toTokenAddress', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/0xinvalid/1000000000000000000`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          message: 'Invalid toTokenAddress',
        });
      });

      it('should return 400 for identical token addresses', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${WETH}/1000000000000000000`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          message: 'Identical token addresses',
        });
      });

      it('should return 400 for zero amountIn', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${USDC}/0`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          message: 'amountIn must be a positive integer',
        });
      });

      it('should return 400 for negative amountIn', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${USDC}/-100`,
        });
        expect(res.statusCode).toBe(400);
      });

      it('should return 400 for decimal amountIn', async () => {
        const res = await app.inject({
          method: 'GET',
          url: `/return/${WETH}/${USDC}/1.5`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({
          message: 'amountIn must be a positive integer',
        });
      });
    });
  });
});
