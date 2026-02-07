import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
        GRACE_PERIOD_MS: Joi.number().default(30_000),
        GAS_PRICE_STALENESS_MS: Joi.number().default(20_000),
        THROTTLE_TTL_MS: Joi.number().default(60_000), // 1 minute window
        THROTTLE_LIMIT: Joi.number().default(1100),
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'regular',
            ttl: config.get<number>('THROTTLE_TTL_MS') ?? 60_000,
            limit: config.get<number>('THROTTLE_LIMIT') ?? 1100,
          },
          {
            name: 'burst_protection',
            ttl: 1000,
            limit: 25,
          },
        ],
      }),
    }),
    HealthModule,
    GasPriceModule,
    EthModule,
    UniswapModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
