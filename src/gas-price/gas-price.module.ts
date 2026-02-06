import { Module } from '@nestjs/common';
import { GasPriceController } from './gas-price.controller';
import { GasPriceService } from './gas-price.service';

@Module({
  controllers: [GasPriceController],
  providers: [GasPriceService],
  exports: [GasPriceService],
})
export class GasPriceModule {}
