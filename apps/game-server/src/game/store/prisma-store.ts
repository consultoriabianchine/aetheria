import { Injectable } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { CharacterEquipment, HuntProgress, ItemStack, VocationId } from '@aetheria/types';
import type { AccountRecord, PromotionError, StoredCharacter, Store } from './store';
import { validatePromotion, applyPromotion } from '../vocations/promotion.service';

interface CharacterRow {
  id: string;
  accountId: string;
  name: string;
  vocation: string;
  promoted: boolean;
  promotedAt: Date | null;
  gold: number;
  position: { x: number; y: number; z: number } | null;
  stats: {
    level: number;
    experience: number;
    health: number;
    maxHealth: number;
    mana: number;
    maxMana: number;
  } | null;
  skills: {
    sword: number;
    axe: number;
    club: number;
    distance: number;
    magic: number;
    shielding: number;
  } | null;
  inventory: { slots: unknown } | null;
  equipment: {
    head?: unknown;
    armor?: unknown;
    legs?: unknown;
    boots?: unknown;
    weapon?: unknown;
    shield?: unknown;
    ring?: unknown;
    amulet?: unknown;
  } | null;
  appearance: {
    outfit_id: number;
    addon_mask: number;
    head_color: number;
    primary_color: number;
    secondary_color: number;
    detail_color: number;
  } | null;
}

function clampInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

const INCLUDE = {
  position: true,
  stats: true,
  skills: true,
  inventory: true,
  equipment: true,
  appearance: true,
} as const;

/** Store persistente em PostgreSQL via Prisma. */
@Injectable()
export class PrismaStore implements Store {
  constructor(private readonly prisma: PrismaService) {}

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const account = await this.prisma.account.findUnique({ where: { username } });
    if (!account) return null;
    return { id: account.id, username: account.username, passwordHash: account.passwordHash };
  }

  async createAccount(username: string, passwordHash: string): Promise<AccountRecord> {
    const account = await this.prisma.account.create({ data: { username, passwordHash } });
    return { id: account.id, username: account.username, passwordHash: account.passwordHash };
  }

  async listCharacters(accountId: string): Promise<StoredCharacter[]> {
    const rows = await this.prisma.character.findMany({
      where: { accountId },
      include: INCLUDE,
    });
    return rows.map((r) => this.toStored(r as unknown as CharacterRow));
  }

  async createCharacter(accountId: string, data: Omit<StoredCharacter, 'id' | 'accountId'>): Promise<StoredCharacter> {
    const character = (await this.prisma.character.create({
      data: {
        accountId,
        name: data.name,
        vocation: data.vocation,
        promoted: data.promoted,
        promotedAt: data.promotedAt ? new Date(data.promotedAt) : null,
        gold: data.gold,
        position: { create: { x: data.position.x, y: data.position.y, z: data.position.z } },
        stats: {
          create: {
            level: data.level,
            experience: data.experience,
            health: data.health,
            maxHealth: data.maxHealth,
            mana: data.mana,
            maxMana: data.maxMana,
            attack: data.skills.sword,
            defense: data.skills.shielding,
          },
        },
        skills: { create: { ...data.skills } },
        skillProgress: {
          create: (Object.keys(data.skills) as (keyof typeof data.skills)[]).map((skillType) => ({
            skillType,
            level: data.skills[skillType],
            experience: 0,
          })),
        },
        inventory: { create: { slots: data.inventory as unknown as Prisma.InputJsonValue } },
        equipment: { create: this.toEquipmentData(data.equipment) as unknown as Prisma.CharacterEquipmentCreateWithoutCharacterInput },
      },
      include: INCLUDE,
    })) as unknown as CharacterRow;
    return this.toStored(character);
  }

  async findCharacterById(id: string): Promise<StoredCharacter | null> {
    const character = await this.prisma.character.findUnique({
      where: { id },
      include: INCLUDE,
    });
    return character ? this.toStored(character as unknown as CharacterRow) : null;
  }

  async saveCharacter(character: StoredCharacter): Promise<void> {
    await this.prisma.character.update({
      where: { id: character.id },
      data: {
        gold: character.gold,
        promoted: character.promoted,
        promotedAt: character.promotedAt ? new Date(character.promotedAt) : null,
        position: { update: { x: character.position.x, y: character.position.y, z: character.position.z } },
        stats: {
          update: {
            level: character.level,
            experience: character.experience,
            health: character.health,
            maxHealth: character.maxHealth,
            mana: character.mana,
            maxMana: character.maxMana,
            attack: character.skills.sword,
            defense: character.skills.shielding,
          },
        },
        skills: { update: { ...character.skills } },
        inventory: { update: { slots: character.inventory as unknown as Prisma.InputJsonValue } },
        equipment: { update: this.toEquipmentData(character.equipment) as unknown as Prisma.CharacterEquipmentUpdateWithoutCharacterInput },
        appearance: character.appearance
          ? {
              upsert: {
                create: {
                  outfit_id: character.appearance.outfitId,
                  addon_mask: character.appearance.addonMask,
                  head_color: character.appearance.colors.head,
                  primary_color: character.appearance.colors.primary,
                  secondary_color: character.appearance.colors.secondary,
                  detail_color: character.appearance.colors.detail,
                },
                update: {
                  outfit_id: character.appearance.outfitId,
                  addon_mask: character.appearance.addonMask,
                  head_color: character.appearance.colors.head,
                  primary_color: character.appearance.colors.primary,
                  secondary_color: character.appearance.colors.secondary,
                  detail_color: character.appearance.colors.detail,
                },
              },
            }
          : undefined,
      },
    });
  }

  async promoteCharacter(
    accountId: string,
    characterId: string,
  ): Promise<{ ok: true; character: StoredCharacter } | { ok: false; error: PromotionError }> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.character.findFirst({
        where: { id: characterId },
        include: INCLUDE,
      });
      if (!locked) return { ok: false, error: 'CHARACTER_NOT_FOUND' };
      if (locked.accountId !== accountId) return { ok: false, error: 'CHARACTER_NOT_OWNED' };
      const stored = this.toStored(locked as unknown as CharacterRow);
      const error = validatePromotion(stored);
      if (error) return { ok: false, error };
      const promoted = applyPromotion(stored);
      await tx.character.update({
        where: { id: characterId },
        data: { gold: promoted.gold, promoted: true, promotedAt: new Date() },
      });
      return { ok: true, character: promoted };
    });
  }

  async getHuntProgress(characterId: string, huntId: string): Promise<HuntProgress | null> {
    const row = await this.prisma.huntProgress.findUnique({
      where: { characterId_huntId: { characterId, huntId } },
    });
    return row ? this.toHuntProgress(row) : null;
  }

  async listHuntProgress(characterId: string): Promise<HuntProgress[]> {
    const rows = await this.prisma.huntProgress.findMany({ where: { characterId } });
    return rows.map((r) => this.toHuntProgress(r));
  }

  async recordHuntCompletion(characterId: string, huntId: string, clearTimeMs: number): Promise<HuntProgress> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.huntProgress.findUnique({
        where: { characterId_huntId: { characterId, huntId } },
      });
      const now = new Date();
      const bestClearTimeMs =
        existing?.bestClearTimeMs == null || clearTimeMs < existing.bestClearTimeMs
          ? clearTimeMs
          : existing.bestClearTimeMs;
      const isBest = bestClearTimeMs === clearTimeMs;
      const row = await tx.huntProgress.upsert({
        where: { characterId_huntId: { characterId, huntId } },
        create: {
          characterId,
          huntId,
          completionCount: 1,
          firstClearAt: now,
          firstClearTimeMs: clearTimeMs,
          bestClearTimeMs,
          bestClearAt: now,
        },
        update: {
          completionCount: (existing?.completionCount ?? 0) + 1,
          firstClearAt: existing?.firstClearAt ?? now,
          firstClearTimeMs: existing?.firstClearTimeMs ?? clearTimeMs,
          bestClearTimeMs,
          bestClearAt: isBest ? now : existing?.bestClearAt ?? now,
        },
      });
      return this.toHuntProgress(row);
    });
  }

  private toHuntProgress(row: {
    huntId: string;
    completionCount: number;
    firstClearAt: Date | null;
    firstClearTimeMs: number | null;
    bestClearTimeMs: number | null;
    bestClearAt: Date | null;
  }): HuntProgress {
    return {
      huntId: row.huntId,
      completionCount: row.completionCount,
      firstClearAt: row.firstClearAt ? row.firstClearAt.getTime() : null,
      firstClearTimeMs: row.firstClearTimeMs,
      bestClearTimeMs: row.bestClearTimeMs,
      bestClearAt: row.bestClearAt ? row.bestClearAt.getTime() : null,
    };
  }

  private toEquipmentData(equipment: CharacterEquipment): Record<string, Prisma.InputJsonValue | undefined> {
    const out: Record<string, Prisma.InputJsonValue | undefined> = {};
    for (const slot of ['head', 'armor', 'legs', 'boots', 'weapon', 'shield', 'ring', 'amulet'] as const) {
      const item = equipment[slot];
      out[slot] = item ? (item as unknown as Prisma.InputJsonValue) : undefined;
    }
    return out;
  }

  private toStored(row: CharacterRow): StoredCharacter {
    const eq = row.equipment ?? {};
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      vocation: (row.vocation ?? 'knight') as VocationId,
      promoted: row.promoted ?? false,
      promotedAt: row.promotedAt ? row.promotedAt.getTime() : null,
      gold: clampInt(row.gold, 0),
      level: clampInt(row.stats?.level, 1),
      experience: clampInt(row.stats?.experience, 0),
      health: clampInt(row.stats?.health, 150),
      maxHealth: clampInt(row.stats?.maxHealth, 150),
      mana: clampInt(row.stats?.mana, 60),
      maxMana: clampInt(row.stats?.maxMana, 60),
      position: {
        x: clampInt(row.position?.x, 32),
        y: clampInt(row.position?.y, 32),
        z: clampInt(row.position?.z, 7),
      },
      skills: {
        sword: clampInt(row.skills?.sword, 10),
        axe: clampInt(row.skills?.axe, 10),
        club: clampInt(row.skills?.club, 10),
        distance: clampInt(row.skills?.distance, 10),
        magic: clampInt(row.skills?.magic, 10),
        shielding: clampInt(row.skills?.shielding, 10),
      },
      inventory: Array.isArray(row.inventory?.slots)
        ? ((row.inventory.slots as (ItemStack | null)[]).map((s) => (s ? { itemId: s.itemId, quantity: s.quantity } : null)) as (ItemStack | null)[])
        : [],
      equipment: {
        head: eq.head ? this.stack(eq.head) : undefined,
        armor: eq.armor ? this.stack(eq.armor) : undefined,
        legs: eq.legs ? this.stack(eq.legs) : undefined,
        boots: eq.boots ? this.stack(eq.boots) : undefined,
        weapon: eq.weapon ? this.stack(eq.weapon) : undefined,
        shield: eq.shield ? this.stack(eq.shield) : undefined,
        ring: eq.ring ? this.stack(eq.ring) : undefined,
        amulet: eq.amulet ? this.stack(eq.amulet) : undefined,
      },
      appearance: row.appearance
        ? {
            outfitId: clampInt(row.appearance.outfit_id, 1),
            addonMask: clampInt(row.appearance.addon_mask, 0),
            colors: {
              head: clampInt(row.appearance.head_color, 0),
              primary: clampInt(row.appearance.primary_color, 0),
              secondary: clampInt(row.appearance.secondary_color, 0),
              detail: clampInt(row.appearance.detail_color, 0),
            },
          }
        : undefined,
    };
  }

  private stack(value: unknown): ItemStack {
    const v = value as { itemId?: unknown; quantity?: unknown };
    return { itemId: String(v?.itemId ?? ''), quantity: clampInt(v?.quantity, 1) };
  }
}