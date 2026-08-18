export type OutfitCategory = 'default' | 'quest' | 'achievement' | 'event' | 'premium' | 'exclusive' | 'admin';

export type OutfitBodyType = 'body_a' | 'body_b' | 'unisex';

export type OutfitUnlockSource = 'default' | 'quest' | 'achievement' | 'event' | 'purchase' | 'admin';

/** Cores da aparência por índice de paleta (0..N). */
export interface AppearanceColors {
  head: number;
  primary: number;
  secondary: number;
  detail: number;
}

/** Definição de um outfit (persistida em `outfits`). */
export interface OutfitDefinition {
  outfitId: number;
  slug: string;
  name: string;
  description: string;
  spriteAssetId: number;
  animationSetId: number;
  colorMaskAssetId?: number;
  category: OutfitCategory;
  bodyType: OutfitBodyType;
  supportsColors: boolean;
  supportsAddons: boolean;
  defaultColors: AppearanceColors;
  availableByDefault: boolean;
  premiumOnly: boolean;
  enabled: boolean;
  published: boolean;
  version: number;
}

/** Aparência atual de um personagem (persistida em `character_appearance`). */
export interface PlayerAppearance {
  outfitId: number;
  addonMask: number;
  colors: AppearanceColors;
}

/** Entrada da paleta central de cores (id = índice estável). */
export interface PaletteColor {
  id: number;
  name: string;
  hex: string;
}
