import { describe, expect, it } from 'vitest';
import { analyzeCreatureCombat } from '../src/game/admin/creature-combat-analyzer';

describe('creature combat analyzer', () => {
  it('calibra o Dragon em level 30 e ataque 130', () => {
    const html = `
      <main id="mw-content-text">
        <h2>Habilidades</h2>
        <p>Físico: Corpo a corpo (0-130)</p>
        <p>Fire: Wave (100-170), Ball 3x3 no alvo (60-110).</p>
        <p>Cura: Self-Healing (38-72).</p>
        <h2>Comportamento</h2>
      </main>`;
    const analysis = analyzeCreatureCombat(html, 1000, 700);

    expect(analysis.suggestedLevel).toBe(30);
    expect(analysis.suggestedAttack).toBe(130);
    expect(analysis.offensiveMax).toBe(170);
    expect(analysis.healMax).toBe(72);
    expect(analysis.abilities).toEqual([
      { kind: 'physical', label: 'Físico', min: 0, max: 130, area: false },
      { kind: 'spell', label: 'Fire', min: 100, max: 170, area: true },
      { kind: 'heal', label: 'Cura', min: 38, max: 72, area: false },
    ]);
  });

  it('extrai habilidades da linha de tabela usada pela TibiaWiki', () => {
    const html = `
      <table>
        <tr>
          <th><b>Habilidades:</b></th>
          <td>Físico: Corpo a corpo (0-130); Fire: Wave (100-170); Cura: Self-Healing (38-72).</td>
        </tr>
      </table>`;
    const analysis = analyzeCreatureCombat(html, 1000, 700);

    expect(analysis.suggestedLevel).toBe(30);
    expect(analysis.suggestedAttack).toBe(130);
    expect(analysis.offensiveMax).toBe(170);
    expect(analysis.healMax).toBe(72);
    expect(analysis.abilities).toEqual([
      { kind: 'physical', label: 'Físico', min: 0, max: 130, area: false },
      { kind: 'spell', label: 'Fire', min: 100, max: 170, area: false },
      { kind: 'heal', label: 'Cura', min: 38, max: 72, area: false },
    ]);
  });
});
