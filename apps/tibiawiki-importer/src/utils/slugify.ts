/**
 * Slug sanitizado para uso como nome de arquivo e identificador.
 * "Barkless Devotee" -> "barkless-devotee", "Boar Man" -> "boar-man".
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}