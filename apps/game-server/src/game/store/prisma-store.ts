import { Injectable } from '@nestjs/common';
import { INVENTORY_SIZE, LOOT_POUCH_SIZE } from '@aetheria/config';
import { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { CharacterEquipment, CombatArchetype, HuntProgress, ItemStack } from '@aetheria/types';
import type { AccountRecord, StoredCharacter, Store } from './store';

interface CharacterRow {
  id: string;
  accountId: string;
  name: string;
  archetype: string;
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
    melee: number;
    distance: number;
    magic: number;
  } | null;
  skillProgress: { skillType: string; level: number; experience: number }[];
  inventory: { slots: unknown } | null;
  equipment: {
    helmet?: unknown;
    armor?: unknown;
    legs?: unknown;
    boots?: unknown;
    weapon?: unknown;
    ring?: unknown;
    necklace?: unknown;
    relic?: unknown;
    offhand?: unknown;
    ammo?: unknown;
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
  skillProgress: true,
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
        archetype: data.archetype,
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
            attack: data.skills.melee,
            defense: 0,
          },
        },
        skills: { create: { ...data.skills } },
        skillProgress: {
          create: (data.skillProgress.length > 0
            ? data.skillProgress
            : (Object.keys(data.skills) as (keyof typeof data.skills)[]).map((skillType) => ({
                skillType,
                level: data.skills[skillType],
                experience: 0,
              }))
          ).map((progress) => ({
            skillType: progress.skillType,
            level: progress.level,
            experience: progress.experience,
          })),
        },
        inventory: { create: { slots: this.toInventoryJson(data.inventory, data.lootPouchSize, data.lootPouch) } },
        equipment: { create: this.toEquipmentData(data.equipment) as unknown as Prisma.CharacterEquipmentCreateWithoutCharacterInput },
        appearance: data.appearance
          ? {
              create: {
                outfit_id: data.appearance.outfitId,
                addon_mask: data.appearance.addonMask,
                head_color: data.appearance.colors.head,
                primary_color: data.appearance.colors.primary,
                secondary_color: data.appearance.colors.secondary,
                detail_color: data.appearance.colors.detail,
              },
            }
          : undefined,
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
        position: { update: { x: character.position.x, y: character.position.y, z: character.position.z } },
        stats: {
          update: {
            level: character.level,
            experience: character.experience,
            health: character.health,
            maxHealth: character.maxHealth,
            mana: character.mana,
            maxMana: character.maxMana,
            attack: character.skills.melee,
            defense: 0,
          },
        },
        skills: { update: { ...character.skills } },
        skillProgress: {
          upsert: character.skillProgress.map((progress) => ({
            where: { characterId_skillType: { characterId: character.id, skillType: progress.skillType } },
            create: { skillType: progress.skillType, level: progress.level, experience: progress.experience },
            update: { level: progress.level, experience: progress.experience },
          })),
        },
        inventory: { update: { slots: this.toInventoryJson(character.inventory, character.lootPouchSize, character.lootPouch) } },
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
    for (const slot of ['helmet', 'armor', 'legs', 'boots', 'ring', 'necklace', 'relic', 'weapon', 'offhand', 'ammo'] as const) {
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
      archetype: (row.archetype ?? 'warrior') as CombatArchetype,
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
        melee: clampInt(row.skills?.melee, 10),
        distance: clampInt(row.skills?.distance, 10),
        magic: clampInt(row.skills?.magic, 10),
      },
      skillProgress: Array.isArray(row.skillProgress)
        ? row.skillProgress.map((p) => ({
            skillType: String(p.skillType) as keyof StoredCharacter['skills'],
            level: clampInt(p.level, 10),
            experience: clampInt(p.experience, 0),
          }))
        : [],
      inventory: this.inventorySlots(row.inventory?.slots, 'backpack', INVENTORY_SIZE),
      lootPouchSize: this.lootPouchSize(row.inventory?.slots),
      lootPouch: this.inventorySlots(row.inventory?.slots, 'lootPouch', this.lootPouchSize(row.inventory?.slots)),
      equipment: {
        helmet: eq.helmet ? this.stack(eq.helmet) : undefined,
        armor: eq.armor ? this.stack(eq.armor) : undefined,
        legs: eq.legs ? this.stack(eq.legs) : undefined,
        boots: eq.boots ? this.stack(eq.boots) : undefined,
        ring: eq.ring ? this.stack(eq.ring) : undefined,
        necklace: eq.necklace ? this.stack(eq.necklace) : undefined,
        relic: eq.relic ? this.stack(eq.relic) : undefined,
        weapon: eq.weapon ? this.stack(eq.weapon) : undefined,
        offhand: eq.offhand ? this.stack(eq.offhand) : undefined,
        ammo: eq.ammo ? this.stack(eq.ammo) : undefined,
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

  private inventorySlots(value: unknown, key: 'backpack' | 'lootPouch', size: number): (ItemStack | null)[] {
    const source = Array.isArray(value)
      ? key === 'backpack'
        ? value
        : []
      : Array.isArray((value as { [K in typeof key]?: unknown })?.[key])
        ? ((value as { [K in typeof key]: unknown[] })[key])
        : [];
    return Array.from({ length: size }, (_, index) => {
      const stack = source[index] as ItemStack | null | undefined;
      return stack ? { itemId: stack.itemId, quantity: stack.quantity } : null;
    });
  }

  private lootPouchSize(value: unknown): number {
    if (Array.isArray(value)) return LOOT_POUCH_SIZE;
    const v = value as { lootPouch?: unknown; lootPouchSize?: unknown } | null | undefined;
    const explicit = clampInt(v?.lootPouchSize, LOOT_POUCH_SIZE);
    const current = Array.isArray(v?.lootPouch) ? v.lootPouch.length : 0;
    return Math.max(LOOT_POUCH_SIZE, explicit, current);
  }

  private toInventoryJson(inventory: (ItemStack | null)[], lootPouchSize: number, lootPouch: (ItemStack | null)[]): Prisma.InputJsonValue {
    const size = Math.max(LOOT_POUCH_SIZE, lootPouchSize, lootPouch.length);
    return {
      backpack: inventory.map((s) => (s ? { ...s } : null)),
      lootPouchSize: size,
      lootPouch: Array.from({ length: size }, (_, index) => {
        const stack = lootPouch[index] ?? null;
        return stack ? { ...stack } : null;
      }),
    } as unknown as Prisma.InputJsonValue;
  }
}
