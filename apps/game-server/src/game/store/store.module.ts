import { DynamicModule, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MemoryStore } from './memory-store';
import { PrismaStore } from './prisma-store';
import { STORE } from './store';

@Module({})
export class StoreModule {
  static register(): DynamicModule {
    const useMemory = process.env.USE_IN_MEMORY === 'true';
    if (useMemory) {
      return {
        module: StoreModule,
        providers: [{ provide: STORE, useValue: new MemoryStore() }],
        exports: [STORE],
      };
    }
    return {
      module: StoreModule,
      imports: [PrismaModule],
      providers: [{ provide: STORE, useClass: PrismaStore }],
      exports: [STORE],
    };
  }
}