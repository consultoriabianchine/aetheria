import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true });
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
  await app.listen(port, process.env.HOST ?? '0.0.0.0');
  console.log(`Aetheria game-server ouvindo em :${port}`);
}

bootstrap();