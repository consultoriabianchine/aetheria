const { io } = require('socket.io-client');

const socket = io('http://localhost:4000', { transports: ['websocket'], reconnection: false });
const events = [];
const monsters = new Map();
let playerPos = null;
let targetId = null;

socket.onAny((e, d) => {
  events.push({ e, d });
  if (e === 'entity.spawned' && d.kind === 'monster') monsters.set(d.id, { x: d.position.x, y: d.position.y, health: d.health });
  if (e === 'entity.moved' && monsters.has(d.id)) { monsters.get(d.id).x = d.position.x; monsters.get(d.id).y = d.position.y; }
  if (e === 'entity.health' && monsters.has(d.id)) monsters.get(d.id).health = d.health;
  if (e === 'player.moved') playerPos = d.position;
  if (e === 'game.enterWorld') playerPos = d.character.position;
  if (e === 'loot.spawned') console.log('LOOT SPAWNED:', JSON.stringify(d));
  if (e === 'combat.death') console.log('DEATH:', JSON.stringify(d));
});

const dirTo = (from, to) => {
  if (from.x < to.x) return 'east';
  if (from.x > to.x) return 'west';
  if (from.y < to.y) return 'south';
  if (from.y > to.y) return 'north';
  return null;
};

const close = (from, to) => Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y)) <= 1;

setTimeout(() => socket.emit('auth.login', { username: 'killer', password: 'senha123' }), 800);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  if (!login || !login.d.ok) { console.log('LOGIN FAILED'); process.exit(1); }
  const char = login.d.characters[0];
  if (char) socket.emit('auth.selectCharacter', { token: login.d.token, characterId: char.id });
  else socket.emit('auth.createCharacter', { token: login.d.token, name: 'MatadoraTeste' });
}, 2000);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  const created = events.find((x) => x.e === 'auth.characterCreated');
  const char = created?.d?.character || login?.d?.characters?.[0];
  if (!login || !login.d.ok || !char) { console.log('SELECT FAILED'); process.exit(1); }
  socket.emit('auth.selectCharacter', { token: login.d.token, characterId: char.id });
}, 3200);

setTimeout(() => {
  const enter = events.find((x) => x.e === 'game.enterWorld');
  if (!enter) { console.log('ENTER FAILED'); process.exit(1); }
  console.log('ENTER OK');
  const kill = setInterval(() => {
    if (!playerPos) return;
    let best = null;
    for (const [id, m] of monsters) {
      if (m.health <= 0) continue;
      const d = Math.abs(playerPos.x - m.x) + Math.abs(playerPos.y - m.y);
      if (!best || d < best.d) best = { id, m, d };
    }
    if (!best) return;
    targetId = best.id;
    if (close(playerPos, best.m)) {
      socket.emit('game.attack', { targetId: best.id });
    } else {
      const dir = dirTo(playerPos, best.m);
      if (dir) socket.emit('game.input', { direction: dir });
    }
  }, 300);
  const finish = setTimeout(() => {
    clearInterval(kill);
    const looted = events.some((x) => x.e === 'loot.spawned');
    console.log('RESULT loot=' + looted);
    socket.disconnect();
    process.exit(looted ? 0 : 1);
  }, 30000);
}, 4600);

socket.on('disconnect', (reason) => {
  console.log('SOCKET DISCONNECTED:', reason);
});