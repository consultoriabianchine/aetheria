import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: true });
  app.useBodyParser('json', { limit: '10mb' });
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port, process.env.HOST ?? '0.0.0.0');
  console.log(`Aetheria game-server ouvindo em :${port}`);
}

bootstrap();