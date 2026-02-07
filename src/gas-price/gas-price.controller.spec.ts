import { Test, TestingModule } from '@nestjs/testing';
import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GasPriceController } from './gas-price.controller';
import { GasPriceService } from './gas-price.service';
import type { GasPriceResponse } from './types';

describe('GasPriceController', () => {
  let controller: GasPriceController;
  let gasPriceService: jest.Mocked<GasPriceService>;

  const mockGasPriceResponse: GasPriceResponse = {
    baseFee: '20000000000',
    low: {
      maxPriorityFeePerGas: '1500000000',
      maxFeePerGas: '23500000000',
    },
    medium: {
      maxPriorityFeePerGas: '1800000000',
      maxFeePerGas: '26800000000',
    },
    high: {
      maxPriorityFeePerGas: '2250000000',
      maxFeePerGas: '32250000000',
    },
    instant: {
      maxPriorityFeePerGas: '3000000000',
      maxFeePerGas: '43000000000',
    },
  };

  beforeEach(async () => {
    const mockGasPriceService = {
      getGasPrice: jest.fn(),
      updateGasPrice: jest.fn(),
      isCacheStale: jest.fn(),
      getLastUpdateTimestamp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GasPriceController],
      providers: [
        {
          provide: GasPriceService,
          useValue: mockGasPriceService,
        },
      ],
    }).compile();

    controller = module.get<GasPriceController>(GasPriceController);
    gasPriceService = module.get(GasPriceService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getGasPrice', () => {
    describe('supported chains', () => {
      it('should return gas prices for Ethereum mainnet (chainId: 1)', () => {
        gasPriceService.getGasPrice.mockReturnValue(mockGasPriceResponse);

        const result = controller.getGasPrice(1);

        expect(result).toEqual(mockGasPriceResponse);
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(gasPriceService.getGasPrice).toHaveBeenCalledTimes(1);
      });

      it('should return all required EIP-1559 fields', () => {
        gasPriceService.getGasPrice.mockReturnValue(mockGasPriceResponse);

        const result = controller.getGasPrice(1);

        expect(result).toHaveProperty('baseFee');
        expect(result).toHaveProperty('low');
        expect(result).toHaveProperty('medium');
        expect(result).toHaveProperty('high');
        expect(result).toHaveProperty('instant');

        // Each tier should have the required fee fields
        for (const tier of ['low', 'medium', 'high', 'instant'] as const) {
          expect(result[tier]).toHaveProperty('maxPriorityFeePerGas');
          expect(result[tier]).toHaveProperty('maxFeePerGas');
        }
      });
    });

    describe('unsupported chains', () => {
      it('should reject unsupported chain with 422', () => {
        expect(() => controller.getGasPrice(137)).toThrow(HttpException);

        try {
          controller.getGasPrice(137);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
          const response = (error as HttpException).getResponse() as {
            statusCode: number;
            message: string;
          };
          expect(response.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
          expect(response.message).toContain('not supported');
        }
      });

      it('should reject Polygon (chainId: 137)', () => {
        expect(() => controller.getGasPrice(137)).toThrow(HttpException);
      });

      it('should reject Arbitrum (chainId: 42161)', () => {
        expect(() => controller.getGasPrice(42161)).toThrow(HttpException);
      });

      it('should reject Base (chainId: 8453)', () => {
        expect(() => controller.getGasPrice(8453)).toThrow(HttpException);
      });

      it('should reject chainId 0', () => {
        expect(() => controller.getGasPrice(0)).toThrow(HttpException);
      });

      it('should include supported chains in error message', () => {
        try {
          controller.getGasPrice(999);
        } catch (error) {
          const response = (error as HttpException).getResponse() as {
            message: string;
          };
          expect(response.message).toContain('Ethereum mainnet (1)');
        }
      });
    });

    describe('service unavailable', () => {
      it('should propagate ServiceUnavailableException when cache is empty', () => {
        gasPriceService.getGasPrice.mockImplementation(() => {
          throw new ServiceUnavailableException(
            'Gas price data not yet available',
          );
        });

        expect(() => controller.getGasPrice(1)).toThrow(
          ServiceUnavailableException,
        );
      });

      it('should return 503 status when cache is empty', () => {
        gasPriceService.getGasPrice.mockImplementation(() => {
          throw new ServiceUnavailableException(
            'Gas price data not yet available',
          );
        });

        try {
          controller.getGasPrice(1);
        } catch (error) {
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
      });
    });

    describe('chain validation order', () => {
      it('should validate chain before calling service', () => {
        // If chain validation happens first, service should never be called
        expect(() => controller.getGasPrice(999)).toThrow();

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(gasPriceService.getGasPrice).not.toHaveBeenCalled();
      });
    });
  });
});
