import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@aetheria/database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (err) {
      this.logger.warn(`Banco indisponível no boot (${(err as Error).message}). Continuando em modo resiliente.`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}