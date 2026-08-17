import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreatureAnimationConfig, CreatureAnimationConfigInput } from '@aetheria/types';
import { creatureAnimationConfigSchema } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';

/** Persistência/validação da configuração de animação (JSONB + version). */
@Injectable()
export class CreatureAnimationService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(creatureId: number): Promise<CreatureAnimationConfig | null> {
    const row = await this.prisma.creatureAnimationConfig.findUnique({ where: { creature_id: creatureId } });
    if (!row) return null;
    return { version: row.version, ...(row.config as unknown as CreatureAnimationConfigInput) };
  }

  async save(
    creatureId: number,
    input: unknown,
    expectedVersion?: number,
  ): Promise<CreatureAnimationConfig> {
    const parsed = creatureAnimationConfigSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Configuração de animação inválida', issues: parsed.error.issues });
    }

    const creature = await this.prisma.creatureDefinition.findUnique({ where: { creature_id: creatureId } });
    if (!creature) throw new NotFoundException('Criatura não encontrada');

    const existing = await this.prisma.creatureAnimationConfig.findUnique({ where: { creature_id: creatureId } });
    if (expectedVersion !== undefined && existing && existing.version !== expectedVersion) {
      throw new ConflictException('A configuração foi alterada por outro admin — recarregue antes de salvar.');
    }

    const nextVersion = (existing?.version ?? 0) + 1;
    const row = await this.prisma.creatureAnimationConfig.upsert({
      where: { creature_id: creatureId },
      create: { creature_id: creatureId, version: nextVersion, config: parsed.data },
      update: { version: nextVersion, config: parsed.data },
    });

    return { version: row.version, ...parsed.data };
  }
}
