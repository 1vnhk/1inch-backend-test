import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

import compress from '@fastify/compress';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(compress, {
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
