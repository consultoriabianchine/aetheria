const { io } = require('socket.io-client');

const socket = io('http://localhost:4000', { transports: ['websocket'], reconnection: false });
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
  socket.emit('auth.createCharacter', { token: login.d.token, name: 'HeroiTeste' });
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
  const moved = events.some((x) => x.e === 'player.moved');
  console.log('RESULT moved=' + moved);
  socket.disconnect();
  process.exit(moved ? 0 : 1);
}, 7200);