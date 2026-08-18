const { io } = require('socket.io-client');
const socket = io('http://127.0.0.1:4000', { transports: ['websocket'], reconnection: false });
const events = [];
socket.onAny((e, d) => events.push({ e, d }));
socket.on('connect_error', (e) => { console.log('CONNECT_ERROR', e.message); process.exit(1); });

const uniq = String(Date.now()).slice(-6);

setTimeout(() => socket.emit('auth.login', { username: 'appear', password: 'senha123' }), 500);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  if (!login || !login.d.ok) { console.log('LOGIN FAILED', JSON.stringify(login?.d)); process.exit(1); }
  socket.emit('auth.createCharacter', { token: login.d.token, name: 'Appear' + uniq, vocation: 'knight' });
}, 1500);

setTimeout(() => {
  const login = events.find((x) => x.e === 'auth.loginResult');
  const created = events.find((x) => x.e === 'auth.characterCreated');
  if (!created?.d?.character) { console.log('CREATE FAILED', JSON.stringify(created?.d)); process.exit(1); }
  socket.emit('auth.selectCharacter', { token: login.d.token, characterId: created.d.character.id });
}, 2500);

setTimeout(() => {
  const enter = events.find((x) => x.e === 'game.enterWorld');
  if (!enter) { console.log('ENTER FAILED'); process.exit(1); }
  console.log('ENTER OK; appearance no enter:', JSON.stringify(enter.d.character.appearance));
  const login = events.find((x) => x.e === 'auth.loginResult');
  socket.emit('appearance.list', { token: login.d.token });
}, 3500);

setTimeout(() => {
  const list = events.find((x) => x.e === 'appearance.list');
  if (!list) { console.log('APPEARANCE LIST FAILED'); process.exit(1); }
  console.log('APPEARANCE LIST OK:', list.d.outfits.map((o) => o.outfitId + ':' + o.name).join(', '));
  const login = events.find((x) => x.e === 'auth.loginResult');
  const first = list.d.outfits[0];
  socket.emit('appearance.save', { token: login.d.token, outfitId: first.outfitId, addonMask: 0, colors: { head: 11, primary: 6, secondary: 18, detail: 12 } });
}, 4500);

setTimeout(() => {
  const changed = events.find((x) => x.e === 'appearance.changed');
  if (!changed) { console.log('APPEARANCE CHANGED FAILED'); process.exit(1); }
  console.log('APPEARANCE CHANGED OK:', JSON.stringify(changed.d));
  console.log('PASS');
  process.exit(0);
}, 5500);
