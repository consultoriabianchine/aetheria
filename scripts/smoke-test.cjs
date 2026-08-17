const { io } = require('socket.io-client');

const socket = io('http://127.0.0.1:4000', { transports: ['websocket'], reconnection: false });
const events = [];
socket.onAny((e, d) => {
  events.push({ e, d });
  console.log('EVT', e, JSON.stringify(d).slice(0, 240));
});
socket.on('connect_error', (err) => {
  console.log('CONNECT_ERROR', err.message);
  process.exit(1);
});

setTimeout(() => {
  socket.emit('auth.login', { username: 'tester', password: 'senha123' });
}, 800);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  if (!login || !login.d.ok) {
    console.log('LOGIN FAILED');
    process.exit(1);
  }
  socket.emit('auth.createCharacter', { token: login.d.token, name: 'HeroiTeste' + String(Date.now()).slice(-6), vocation: 'knight' });
}, 2000);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  const created = events.find((x) => x.e === 'auth.characterCreated');
  const char = created?.d?.character;
  if (!login || !login.d.ok || !char) {
    console.log('CREATE FAILED');
    process.exit(1);
  }
  socket.emit('auth.selectCharacter', { token: login.d.token, characterId: char.id });
}, 3200);

setTimeout(() => {
  const enter = events.find((x) => x.e === 'game.enterWorld');
  if (!enter) {
    console.log('ENTER WORLD FAILED');
    process.exit(1);
  }
  console.log('ENTER OK: tiles=' + enter.d.map.length + ' char@' + JSON.stringify(enter.d.character.position) + ' monsters=' + events.filter((x) => x.e === 'entity.spawned' && x.d.kind === 'monster').length);
  socket.emit('game.input', { direction: 'east' });
  socket.emit('game.input', { direction: 'east' });
}, 4600);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  socket.emit('hunt.list', { token: login.d.token });
}, 5400);

setTimeout(() => {
  const list = events.find((x) => x.e === 'hunt.list');
  if (!list || !list.d.hunts || list.d.hunts.length === 0) {
    console.log('HUNT LIST FAILED');
    process.exit(1);
  }
  console.log('HUNT LIST OK: ' + list.d.hunts.map((h) => h.ladderPosition + '.' + h.name).join(' | '));
  const login = events.find((x) => x.e === 'auth.loginResult');
  socket.emit('hunt.start', { token: login.d.token, huntId: 'goblin_warren', loopEnabled: false });
}, 5800);

setTimeout(() => {
  const arena = events.find((x) => x.e === 'game.enterArena');
  const wave = events.find((x) => x.e === 'hunt.wave');
  const spawns = events.filter((x) => x.e === 'creature.spawn');
  if (!arena || !wave || spawns.length === 0) {
    console.log('HUNT START FAILED arena=' + !!arena + ' wave=' + !!wave + ' spawns=' + spawns.length);
    process.exit(1);
  }
  console.log('HUNT START OK: wave=' + wave.d.wave + ' spawns=' + spawns.length + ' arena=' + arena.d.width + 'x' + arena.d.height);
  const login = events.find((x) => x.e === 'auth.loginResult');
  socket.emit('hunt.stop', { token: login.d.token });
}, 6600);

setTimeout(() => {
  const returned = events.some((x) => x.e === 'hunt.returnedToCity');
  const moved = events.some((x) => x.e === 'player.moved');
  console.log('RESULT moved=' + moved + ' returnedToCity=' + returned);
  socket.disconnect();
  process.exit(moved && returned ? 0 : 1);
}, 8000);