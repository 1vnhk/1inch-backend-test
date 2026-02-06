import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Header,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { GasService } from './gas.service';

const SUPPORTED_CHAINS: Set<number> = new Set([1]); // Only Ethereum mainnet (chainId: 1) for now

@Controller('gasPrice')
export class GasController {
  constructor(private readonly gasService: GasService) {}

  @Get(':chainId')
  @Header('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10')
  @Header('Content-Type', 'application/json')
  getGasPrice(
    @Param(
      'chainId',
      new ParseIntPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () =>
          new BadRequestException('Chain ID must be an integer'),
      }),
    )
    chainId: number,
  ): null {
    if (!SUPPORTED_CHAINS.has(chainId)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: `Chain ${chainId} not supported. Only Ethereum mainnet (1) is supported for now.`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // TODO: call gas service
    // TODO: implement gas service

    return null;
  }
}
