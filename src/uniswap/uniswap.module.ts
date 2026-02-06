import { Module } from '@nestjs/common';
import { EthModule } from '../eth/eth.module';
import { UniswapController } from './uniswap.controller';
import { UniswapService } from './uniswap.service';

@Module({
  imports: [EthModule],
  controllers: [UniswapController],
  providers: [UniswapService],
  exports: [UniswapService],
})
export class UniswapModule {}
