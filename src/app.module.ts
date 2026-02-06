import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health';
import { GasPriceModule } from './gas-price';
import { EthModule } from './eth/eth.module';
import { UniswapModule } from './uniswap';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV ?? 'development'}.local`,
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        ETH_NODE_WS: Joi.string().required(),
      }),
    }),
    HealthModule,
    GasPriceModule,
    EthModule,
    UniswapModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
