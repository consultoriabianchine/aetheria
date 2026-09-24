import { Injectable } from '@nestjs/common';
import { INVENTORY_SIZE, LOOT_POUCH_SIZE } from '@aetheria/config';
import { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { CharacterEquipment, CombatArchetype, HuntProgress, ItemStack, PlayerCombatConfig } from '@aetheria/types';
import type { AbyssMetaProgression, AbyssRunHistory, AccountRecord, StoredAccountStorage, StoredCharacter, Store } from './store';

interface AccountStorageRow {
  accountId: string;
  gold: number;
  backpack: unknown;
  lootPouchSize: number;
  lootPouch: unknown;
  unlockedPartySlots: number;
  party: unknown;
}

interface CharacterRow {
  id: string;
  accountId: string;
  name: string;
  archetype: string;
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
  combatConfig: { targeting: string; movement: string; attack_range: number | null } | null;
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
  equipment: true,
  appearance: true,
  combatConfig: true,
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
        combatConfig: data.combat
          ? {
              create: {
                targeting: data.combat.targeting,
                movement: data.combat.movement,
                attack_range: data.combat.attackRange ?? null,
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

  async getWeaponElementOverride(characterId: string) {
    const effect = await this.prisma.characterEffect.findUnique({ where: { characterId_type: { characterId, type: 'weapon_element_override' } } });
    if (!effect || effect.expiresAt.getTime() <= Date.now()) {
      if (effect) await this.prisma.characterEffect.delete({ where: { id: effect.id } });
      return null;
    }
    const payload = effect.payload as { damageType?: string; appliedAt?: number; expiresAt?: number };
    if (!payload.damageType || !payload.appliedAt || !payload.expiresAt) return null;
    return { damageType: payload.damageType as import('@aetheria/types').DamageType, appliedAt: payload.appliedAt, expiresAt: payload.expiresAt };
  }

  async saveWeaponElementOverride(characterId: string, override: import('@aetheria/types').WeaponElementOverride): Promise<void> {
    await this.prisma.characterEffect.upsert({
      where: { characterId_type: { characterId, type: 'weapon_element_override' } },
      create: { characterId, type: 'weapon_element_override', payload: override as unknown as Prisma.InputJsonValue, expiresAt: new Date(override.expiresAt) },
      update: { payload: override as unknown as Prisma.InputJsonValue, expiresAt: new Date(override.expiresAt) },
    });
  }

  async clearWeaponElementOverride(characterId: string): Promise<void> {
    await this.prisma.characterEffect.deleteMany({ where: { characterId, type: 'weapon_element_override' } });
  }

  async saveCharacter(character: StoredCharacter): Promise<void> {
    await this.prisma.character.update({
      where: { id: character.id },
      data: {
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
        combatConfig: character.combat
          ? {
              upsert: {
                create: {
                  targeting: character.combat.targeting,
                  movement: character.combat.movement,
                  attack_range: character.combat.attackRange ?? null,
                },
                update: {
                  targeting: character.combat.targeting,
                  movement: character.combat.movement,
                  attack_range: character.combat.attackRange ?? null,
                },
              },
            }
          : undefined,
      },
    });
  }

  async getAccountStorage(accountId: string): Promise<StoredAccountStorage | null> {
    const row = await this.prisma.accountStorage.findUnique({ where: { accountId } });
    return row ? this.toAccountStorage(row as unknown as AccountStorageRow) : null;
  }

  async saveAccountStorage(storage: StoredAccountStorage): Promise<void> {
    await this.prisma.accountStorage.upsert({
      where: { accountId: storage.accountId },
      create: {
        accountId: storage.accountId,
        gold: storage.gold,
        backpack: this.toSlotsJson(storage.inventory),
        lootPouchSize: this.normalizedLootPouchSize(storage),
        lootPouch: this.toSlotsJson(this.paddedLootPouch(storage)),
        unlockedPartySlots: storage.unlockedPartySlots,
        party: storage.party as unknown as Prisma.InputJsonValue,
      },
      update: {
        gold: storage.gold,
        backpack: this.toSlotsJson(storage.inventory),
        lootPouchSize: this.normalizedLootPouchSize(storage),
        lootPouch: this.toSlotsJson(this.paddedLootPouch(storage)),
        unlockedPartySlots: storage.unlockedPartySlots,
        party: storage.party as unknown as Prisma.InputJsonValue,
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
          favorite: false,
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

  async setHuntFavorite(characterId: string, huntId: string, favorite: boolean): Promise<HuntProgress> {
    const row = await this.prisma.huntProgress.upsert({
      where: { characterId_huntId: { characterId, huntId } },
      create: {
        characterId,
        huntId,
        completionCount: 0,
        favorite,
      },
      update: { favorite },
    });
    return this.toHuntProgress(row);
  }

  async getAbyssMeta(accountId: string): Promise<AbyssMetaProgression> {
    const row = await this.prisma.abyssMetaProgression.upsert({
      where: { accountId },
      create: { accountId },
      update: {},
    });
    return {
      accountId: row.accountId,
      fragments: row.fragments,
      unlockedNodes: Array.isArray(row.unlockedNodes) ? row.unlockedNodes.filter((v): v is string => typeof v === 'string') : [],
      rerolls: row.rerolls,
      revives: row.revives,
    };
  }

  async saveAbyssMeta(meta: AbyssMetaProgression): Promise<void> {
    await this.prisma.abyssMetaProgression.upsert({
      where: { accountId: meta.accountId },
      create: { accountId: meta.accountId, fragments: meta.fragments, unlockedNodes: meta.unlockedNodes, rerolls: meta.rerolls, revives: meta.revives },
      update: { fragments: meta.fragments, unlockedNodes: meta.unlockedNodes, rerolls: meta.rerolls, revives: meta.revives },
    });
  }

  async recordAbyssRun(history: AbyssRunHistory): Promise<void> {
    await this.prisma.abyssRunHistory.create({
      data: {
        accountId: history.accountId,
        characterId: history.characterId,
        result: history.result,
        durationMs: history.durationMs,
        level: history.level,
        torment: history.torment,
        fragments: history.fragments,
        rewards: history.rewards,
        seed: history.seed,
      },
    });
  }

  private toHuntProgress(row: {
    huntId: string;
    completionCount: number;
    firstClearAt: Date | null;
    firstClearTimeMs: number | null;
    bestClearTimeMs: number | null;
    bestClearAt: Date | null;
    favorite: boolean;
  }): HuntProgress {
    return {
      huntId: row.huntId,
      completionCount: row.completionCount,
      firstClearAt: row.firstClearAt ? row.firstClearAt.getTime() : null,
      firstClearTimeMs: row.firstClearTimeMs,
      bestClearTimeMs: row.bestClearTimeMs,
      bestClearAt: row.bestClearAt ? row.bestClearAt.getTime() : null,
      favorite: row.favorite,
    };
  }

  private toEquipmentData(equipment: CharacterEquipment): Record<string, Prisma.InputJsonValue | null | undefined> {
    const out: Record<string, Prisma.InputJsonValue | null | undefined> = {};
    for (const slot of ['helmet', 'armor', 'legs', 'boots', 'ring', 'necklace', 'relic', 'weapon', 'offhand', 'ammo'] as const) {
      const item = equipment[slot];
      // JSON fields need an explicit null to remove a previously equipped item.
      out[slot] = item ? (item as unknown as Prisma.InputJsonValue) : null;
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
      combat: row.combatConfig
        ? {
            targeting: (row.combatConfig.targeting as PlayerCombatConfig['targeting']) ?? 'nearest',
            movement: (row.combatConfig.movement as PlayerCombatConfig['movement']) ?? 'hold',
            attackRange: row.combatConfig.attack_range ?? undefined,
          }
        : undefined,
    };
  }

  private stack(value: unknown): ItemStack {
    const v = value as { itemId?: unknown; quantity?: unknown };
    return { itemId: String(v?.itemId ?? ''), quantity: clampInt(v?.quantity, 1) };
  }

  private toAccountStorage(row: AccountStorageRow): StoredAccountStorage {
    const lootPouchSize = Math.max(LOOT_POUCH_SIZE, clampInt(row.lootPouchSize, LOOT_POUCH_SIZE));
    return {
      accountId: row.accountId,
      gold: clampInt(row.gold, 0),
      inventory: this.slotsFromJson(row.backpack, INVENTORY_SIZE),
      lootPouchSize,
      lootPouch: this.slotsFromJson(row.lootPouch, lootPouchSize),
      unlockedPartySlots: clampInt(row.unlockedPartySlots, 1),
      party: Array.isArray(row.party) ? row.party.map((id) => String(id)) : [],
    };
  }

  private slotsFromJson(value: unknown, size: number): (ItemStack | null)[] {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length: size }, (_, index) => {
      const stack = source[index] as ItemStack | null | undefined;
      return stack && typeof stack.itemId === 'string'
        ? { itemId: stack.itemId, quantity: clampInt(stack.quantity, 1) }
        : null;
    });
  }

  private toSlotsJson(slots: (ItemStack | null)[]): Prisma.InputJsonValue {
    return slots.map((s) => (s ? { itemId: s.itemId, quantity: s.quantity } : null)) as unknown as Prisma.InputJsonValue;
  }

  private normalizedLootPouchSize(storage: StoredAccountStorage): number {
    return Math.max(LOOT_POUCH_SIZE, storage.lootPouchSize, storage.lootPouch.length);
  }

  private paddedLootPouch(storage: StoredAccountStorage): (ItemStack | null)[] {
    const size = this.normalizedLootPouchSize(storage);
    return Array.from({ length: size }, (_, index) => storage.lootPouch[index] ?? null);
  }
}
