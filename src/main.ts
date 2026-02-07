import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compress from '@fastify/compress';
import fastifyEtag from '@fastify/etag';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      keepAliveTimeout: 65000,
      maxRequestsPerSocket: 0, // Unlimited requests over one connection

      ajv: {
        customOptions: {
          coerceTypes: true,
          removeAdditional: true,
        },
      },
    }),
  );

  await app.register(compress, {
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3000;

  await app.register(fastifyEtag);

  await app.listen(port, '0.0.0.0');
}
bootstrap();
