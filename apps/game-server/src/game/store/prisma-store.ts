import { Injectable } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { CharacterEquipment, ItemStack } from '@aetheria/types';
import type { AccountRecord, StoredCharacter, Store } from './store';

interface CharacterRow {
  id: string;
  accountId: string;
  name: string;
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
    defense: number;
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
            defense: data.skills.defense,
          },
        },
        skills: { create: { ...data.skills } },
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
            defense: character.skills.defense,
          },
        },
        skills: { update: { ...character.skills } },
        inventory: { update: { slots: character.inventory as unknown as Prisma.InputJsonValue } },
        equipment: { update: this.toEquipmentData(character.equipment) as unknown as Prisma.CharacterEquipmentUpdateWithoutCharacterInput },
      },
    });
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
        defense: clampInt(row.skills?.defense, 10),
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
    };
  }

  private stack(value: unknown): ItemStack {
    const v = value as { itemId?: unknown; quantity?: unknown };
    return { itemId: String(v?.itemId ?? ''), quantity: clampInt(v?.quantity, 1) };
  }
}