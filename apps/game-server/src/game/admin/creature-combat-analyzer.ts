import * as cheerio from 'cheerio';

export interface CreatureAbilitySummary {
  kind: 'physical' | 'spell' | 'heal';
  label: string;
  min: number;
  max: number;
  area: boolean;
}

export interface CreatureCombatAnalysis {
  abilities: CreatureAbilitySummary[];
  physicalAttackMax: number | null;
  offensiveMax: number | null;
  healMax: number | null;
  suggestedAttack: number;
  suggestedLevel: number;
}

const DRAGON_REFERENCE = { hp: 1000, experience: 700, attack: 130, spell: 170, heal: 72, level: 30 };

export function analyzeCreatureCombat(html: string, hp: number | null, experience: number | null): CreatureCombatAnalysis {
  const $ = cheerio.load(html);
  const text = findAbilitiesText($);
  const abilities: CreatureAbilitySummary[] = [];
  const segments = text.split(/(?=(?:f[ií]sico|physical|fogo|fire|terra|earth|gelo|ice|energia|energy|morte|death|sagrado|holy|cura|heal)\s*:)/i).map((value) => value.trim()).filter(Boolean);

  for (const segment of segments) {
    const ranges = [...segment.matchAll(/(\d+)\s*[-–—]\s*(\d+)/g)].map((match) => ({ min: Number(match[1]), max: Number(match[2]) }));
    if (!ranges.length) continue;
    const label = segment.match(/^([^:]+):/i)?.[1]?.trim() ?? 'Habilidade';
    const isHeal = /^(cura|heal)/i.test(label);
    const isPhysical = /^(f[ií]sico|physical)/i.test(label);
    const range = ranges.reduce((best, current) => current.max > best.max ? current : best, ranges[0]);
    abilities.push({ kind: isHeal ? 'heal' : isPhysical ? 'physical' : 'spell', label, min: range.min, max: range.max, area: /\d+\s*x\s*\d+/i.test(segment) });
  }

  const physicalAttackMax = maxOf(abilities.filter((ability) => ability.kind === 'physical').map((ability) => ability.max));
  const offensiveMax = maxOf(abilities.filter((ability) => ability.kind !== 'heal').map((ability) => ability.max));
  const healMax = maxOf(abilities.filter((ability) => ability.kind === 'heal').map((ability) => ability.max));
  const suggestedAttack = physicalAttackMax ?? 1;
  const score = weightedScore({ hp, experience, attack: physicalAttackMax, spell: offensiveMax, heal: healMax });
  const suggestedLevel = Math.max(1, Math.min(300, Math.round(DRAGON_REFERENCE.level * score)));

  return { abilities, physicalAttackMax, offensiveMax, healMax, suggestedAttack, suggestedLevel };
}

function findAbilitiesText($: cheerio.CheerioAPI): string {
  const section = $('h2, h3').filter((_, heading) => /^habilidades$|^abilities$/i.test($(heading).text().replace(/\[editar\]|\[edit\]/gi, '').trim())).first();
  if (section.length) return section.nextUntil('h2, h3').text().replace(/\s+/g, ' ').trim();

  const label = $('b, strong').filter((_, element) => /^habilidades:?$|^abilities:?$/i.test($(element).text().trim())).first();
  if (!label.length) return '';

  const row = label.closest('tr');
  if (!row.length) return label.parent().text().replace(/\s+/g, ' ').trim();

  const cells = row.children('th, td');
  return (cells.length > 1 ? cells.last().text() : row.text()).replace(/\s+/g, ' ').trim();
}

function weightedScore(values: { hp: number | null; experience: number | null; attack: number | null; spell: number | null; heal: number | null }): number {
  const hpScore = values.hp ? Math.sqrt(values.hp / DRAGON_REFERENCE.hp) : 0;
  const experienceScore = values.experience ? Math.sqrt(values.experience / DRAGON_REFERENCE.experience) : 0;
  const attackScore = values.attack ? values.attack / DRAGON_REFERENCE.attack : 0;
  const spellScore = values.spell ? values.spell / DRAGON_REFERENCE.spell : 0;
  const healScore = values.heal ? values.heal / DRAGON_REFERENCE.heal : 0;
  return 0.4 * hpScore + 0.2 * experienceScore + 0.2 * attackScore + 0.15 * spellScore + 0.05 * healScore;
}

function maxOf(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}
