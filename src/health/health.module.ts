import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { EthModule } from '../eth/eth.module';
import { GasPriceModule } from '../gas-price/gas-price.module';
import { EthWsHealthIndicator } from './eth-ws.health';

@Module({
  imports: [TerminusModule, EthModule, GasPriceModule],
  controllers: [HealthController],
  providers: [EthWsHealthIndicator],
})
export class HealthModule {}
