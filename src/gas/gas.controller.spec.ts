import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { GasController } from './gas.controller';
import { GasService } from './gas.service';

describe('GasController', () => {
  let controller: GasController;
  let gasService: GasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GasController],
      providers: [GasService],
    }).compile();

    controller = module.get<GasController>(GasController);
    gasService = module.get<GasService>(GasService);
  });

  describe('controller setup', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });

    it('should have gasService injected', () => {
      expect(gasService).toBeDefined();
    });
  });

  describe('getGasPrice', () => {
    describe('supported chains', () => {
      // TODO: change later when response is implemented properly
      it('should return null for Ethereum mainnet (chainId: 1)', () => {
        const ethereumChainId = 1;
        const result = controller.getGasPrice(ethereumChainId);

        expect(result).toBeNull();
      });
    });

    describe('unsupported chains', () => {
      it('should throw HttpException with UNPROCESSABLE_ENTITY for unsupported chainId', () => {
        const optimismChainId = 10;

        expect(() => controller.getGasPrice(optimismChainId)).toThrow(
          HttpException,
        );
      });

      it('should include correct status code and error message in the response', () => {
        const optimismChainId = 10;

        try {
          controller.getGasPrice(optimismChainId);
          fail('Expected HttpException to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
          expect((error as HttpException).getResponse()).toEqual({
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            message: `Chain ${optimismChainId} not supported. Only Ethereum mainnet (1) is supported for now.`,
          });
        }
      });
    });
  });
});
