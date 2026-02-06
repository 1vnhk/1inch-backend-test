import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health';
import { GasModule } from './gas';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV ?? 'development'}`,
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
      }),
    }),
    HealthModule,
    GasModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
