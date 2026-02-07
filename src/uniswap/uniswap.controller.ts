import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UniswapService } from './uniswap.service';
import { SwapReturnDto } from './dto';
import { ethers } from 'ethers';

// Regex for positive integer (no leading zeros except "0" itself)
const POSITIVE_INT_REGEX = /^[1-9]\d*$/;

@Controller('return')
export class UniswapController {
  constructor(private readonly uniswapService: UniswapService) {}

  @Get(':fromTokenAddress/:toTokenAddress/:amountIn')
  async getReturnAmount(
    @Param('fromTokenAddress') fromTokenAddress: string,
    @Param('toTokenAddress') toTokenAddress: string,
    @Param('amountIn') amountIn: string, // Keep as string to preserve uint256 precision
  ): Promise<SwapReturnDto> {
    if (!ethers.utils.isAddress(fromTokenAddress)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid fromTokenAddress',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!ethers.utils.isAddress(toTokenAddress)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid toTokenAddress',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (fromTokenAddress.toLowerCase() === toTokenAddress.toLowerCase()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Identical token addresses',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!POSITIVE_INT_REGEX.test(amountIn)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'amountIn must be a positive integer',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const amountOut = await this.uniswapService.getReturnAmount(
        fromTokenAddress,
        toTokenAddress,
        amountIn,
      );

      return { amountOut: amountOut.toString() };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage === 'INSUFFICIENT_LIQUIDITY') {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            message: 'Insufficient liquidity in the pool',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      if (errorMessage === 'INSUFFICIENT_INPUT_AMOUNT') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Input amount must be greater than zero',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Handle pair not found (contract call reverts)
      if (
        errorMessage.includes('call revert') ||
        errorMessage.includes('CALL_EXCEPTION')
      ) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: 'Pair does not exist for the given token addresses',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      // Handle provider not ready
      if (errorMessage.includes('provider not available')) {
        throw new HttpException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'Service is starting up, please try again',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      // Log unexpected errors for debugging
      console.error('Unexpected error in getReturnAmount:', error);

      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to calculate return amount',
          error: errorMessage,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
