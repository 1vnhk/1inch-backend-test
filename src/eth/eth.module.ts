import { Module } from '@nestjs/common';
import { GasPriceModule } from '../gas-price/gas-price.module';
import { EthService } from './eth.service';

@Module({
  imports: [GasPriceModule],
  providers: [EthService],
  exports: [EthService],
})
export class EthModule {}
