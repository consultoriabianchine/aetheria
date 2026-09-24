const { io } = require('socket.io-client');

const socket = io('http://127.0.0.1:4000', { transports: ['websocket'], reconnection: false });
const events = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (event, timeout = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = events.find((entry) => entry.event === event);
    if (found) return found.data;
    await wait(50);
  }
  throw new Error(`Evento não recebido: ${event}`);
};
const waitForMatch = async (event, predicate, timeout = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = events.find((entry) => entry.event === event && predicate(entry.data));
    if (found) return found.data;
    await wait(50);
  }
  throw new Error(`Evento não recebido: ${event}`);
};
const waitForAfter = async (event, startIndex, timeout = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const found = events.slice(startIndex).find((entry) => entry.event === event);
    if (found) return found.data;
    await wait(50);
  }
  throw new Error(`Evento não recebido após a saída: ${event}`);
};

socket.onAny((event, data) => events.push({ event, data }));
socket.on('connect_error', (error) => { throw error; });

async function main() {
  const username = `abyss_test_${Date.now()}`;
  socket.emit('auth.login', { username, password: 'senha123' });
  const login = await waitFor('auth.loginResult');
  if (!login.ok) throw new Error('Login falhou');

  socket.emit('auth.createCharacter', { token: login.token, name: `Abyss${Date.now()}`.slice(0, 16), archetype: 'mage' });
  const created = await waitFor('auth.characterCreated');
  if (!created.ok) throw new Error(`Criação falhou: ${created.error}`);
  socket.emit('auth.selectCharacter', { token: login.token, characterId: created.character.id });
  await waitFor('game.enterWorld');

  socket.emit('abyss.start', { token: login.token, torment: 1 });
  const entered = await waitFor('game.enterAbyss');
  if (!entered.abyss || entered.abyss.level !== 1) throw new Error('Estado inicial do Abismo inválido');
  await waitFor('creature.spawn');
  await waitForMatch('combat.damage', (data) => data.attackerId === created.character.id, 5000);
  const fragmentDrop = await waitFor('abyss.fragmentDrop', 30000);
  if (!fragmentDrop || fragmentDrop.amount < 1 || fragmentDrop.total < fragmentDrop.amount) throw new Error('Drop de fragmento não foi processado');

  const start = entered.character.position;
  const tileAt = (x, y) => entered.map.find((tile) => tile.x === x && tile.y === y && tile.z === start.z);
  const directions = [
    ['east', 1, 0], ['west', -1, 0], ['south', 0, 1], ['north', 0, -1],
  ];
  const step = directions.find(([, dx, dy]) => tileAt(start.x + dx, start.y + dy)?.walkable);
  if (!step) throw new Error(`Mapa do Abismo não possui movimento caminhável próximo ao spawn: ${JSON.stringify(start)}`);
  console.log(`ABYSS MAP: ${entered.width}x${entered.height} render=${entered.render ? `${entered.render.tilesets?.length ?? 0} tileset(s)` : 'fallback'} spawn=${JSON.stringify(start)} step=${step[0]}`);
  const movementEventsBefore = events.filter((entry) => entry.event === 'player.moved').length;
  for (const [direction] of directions) {
    socket.emit('game.input', { direction });
    await wait(180);
    if (events.filter((entry) => entry.event === 'player.moved').length > movementEventsBefore) break;
  }
  const moved = await waitForMatch('player.moved', () => true, 1000);
  if (!moved?.position) throw new Error('Movimento manual não foi processado');

  const abilities = events.find((entry) => entry.event === 'abilities.update')?.data?.abilities ?? [];
  if (abilities[0]) socket.emit('ability.cast', { abilityId: abilities[0].abilityId });
  const failed = await waitForMatch('ability.castFailed', (data) => data.reason === 'ABYSS_AUTO_CAST_ONLY');
  if (failed.reason !== 'ABYSS_AUTO_CAST_ONLY') throw new Error(`Cast manual não bloqueado: ${failed.reason}`);

  const returnEventIndex = events.length;
  socket.emit('abyss.stop', { token: login.token });
  const abandoned = await waitFor('abyss.abandoned');
  const returned = await waitForAfter('game.enterWorld', returnEventIndex);
  await wait(250);
  const returnEvents = events.slice(returnEventIndex).filter((entry) => entry.event === 'game.enterWorld');
  if (returnEvents.length !== 1) throw new Error(`Retorno ao mundo duplicado: ${returnEvents.length} eventos`);
  if (abandoned.fragments !== 0 || !returned.character?.position) throw new Error('Saída do Abismo não restaurou o jogador corretamente');

  const state = await waitFor('abyss.state', 3000);
  if (!state.abyss || state.abyss.wave < 1) throw new Error('Estado da wave inválido');
  console.log(`ABYSS OK: creatures=${events.filter((entry) => entry.event === 'creature.spawn').length} wave=${state.abyss.wave} fragments=+${fragmentDrop.amount} movement=ok autoCast=ok manualCast=blocked`);
  socket.disconnect();
}

main().catch((error) => {
  console.error(`ABYSS FAILED: ${error.message}`);
  socket.disconnect();
  process.exitCode = 1;
});
