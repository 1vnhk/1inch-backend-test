import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { UniswapController } from './uniswap.controller';
import { UniswapService } from './uniswap.service';

describe('UniswapController', () => {
  let controller: UniswapController;
  let uniswapService: jest.Mocked<UniswapService>;

  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  beforeEach(async () => {
    const mockUniswapService = {
      getReturnAmount: jest.fn(),
      computePairAddress: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UniswapController],
      providers: [
        {
          provide: UniswapService,
          useValue: mockUniswapService,
        },
      ],
    }).compile();

    controller = module.get<UniswapController>(UniswapController);
    uniswapService = module.get(UniswapService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getReturnAmount', () => {
    describe('input validation', () => {
      it('should reject invalid fromTokenAddress', async () => {
        await expect(
          controller.getReturnAmount('invalid', USDC, 1000000000000000000),
        ).rejects.toThrow(HttpException);

        try {
          await controller.getReturnAmount(
            'invalid',
            USDC,
            1000000000000000000,
          );
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.BAD_REQUEST,
          );
          expect((error as HttpException).getResponse()).toMatchObject({
            message: 'Invalid fromTokenAddress',
          });
        }
      });

      it('should reject invalid toTokenAddress', async () => {
        await expect(
          controller.getReturnAmount(WETH, '0xINVALID', 1000000000000000000),
        ).rejects.toThrow(HttpException);

        try {
          await controller.getReturnAmount(
            WETH,
            '0xINVALID',
            1000000000000000000,
          );
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.BAD_REQUEST,
          );
          expect((error as HttpException).getResponse()).toMatchObject({
            message: 'Invalid toTokenAddress',
          });
        }
      });

      it('should reject identical addresses', async () => {
        await expect(
          controller.getReturnAmount(WETH, WETH, 1000000000000000000),
        ).rejects.toThrow(HttpException);

        try {
          await controller.getReturnAmount(WETH, WETH, 1000000000000000000);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.BAD_REQUEST,
          );
          expect((error as HttpException).getResponse()).toMatchObject({
            message: 'Identical token addresses',
          });
        }
      });

      it('should reject zero amountIn', async () => {
        await expect(controller.getReturnAmount(WETH, USDC, 0)).rejects.toThrow(
          HttpException,
        );

        try {
          await controller.getReturnAmount(WETH, USDC, 0);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.BAD_REQUEST,
          );
          expect((error as HttpException).getResponse()).toMatchObject({
            message: 'amountIn must be positive',
          });
        }
      });

      it('should reject negative amountIn', async () => {
        await expect(
          controller.getReturnAmount(WETH, USDC, -100),
        ).rejects.toThrow(HttpException);

        try {
          await controller.getReturnAmount(WETH, USDC, -100);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.BAD_REQUEST,
          );
        }
      });
    });

    describe('successful swap calculation', () => {
      it('should return amountOut on success', async () => {
        const expectedAmountOut = BigInt('1970000000');
        uniswapService.getReturnAmount.mockResolvedValue(expectedAmountOut);

        const result = await controller.getReturnAmount(
          WETH,
          USDC,
          1000000000000000000,
        );

        expect(result).toEqual({ amountOut: '1970000000' });
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(uniswapService.getReturnAmount).toHaveBeenCalledWith(
          WETH,
          USDC,
          1000000000000000000,
        );
      });

      it('should handle decimal amounts', async () => {
        const expectedAmountOut = BigInt('500000000');
        uniswapService.getReturnAmount.mockResolvedValue(expectedAmountOut);

        const result = await controller.getReturnAmount(WETH, USDC, 0.5e18);

        expect(result.amountOut).toBe('500000000');
      });
    });

    describe('error handling', () => {
      it('should return 422 for insufficient liquidity', async () => {
        uniswapService.getReturnAmount.mockRejectedValue(
          new Error('INSUFFICIENT_LIQUIDITY'),
        );

        try {
          await controller.getReturnAmount(WETH, USDC, 1000000000000000000);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
          expect((error as HttpException).getResponse()).toMatchObject({
            message: 'Insufficient liquidity in the pool',
          });
        }
      });

      it('should return 404 for non-existent pair', async () => {
        uniswapService.getReturnAmount.mockRejectedValue(
          new Error('call revert exception'),
        );

        try {
          await controller.getReturnAmount(WETH, USDC, 1000000000000000000);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.NOT_FOUND,
          );
          expect((error as HttpException).getResponse()).toMatchObject({
            message: 'Pair does not exist for the given token addresses',
          });
        }
      });

      it('should return 500 for unknown errors', async () => {
        uniswapService.getReturnAmount.mockRejectedValue(
          new Error('Unknown error'),
        );

        try {
          await controller.getReturnAmount(WETH, USDC, 1000000000000000000);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      });
    });
  });
});
