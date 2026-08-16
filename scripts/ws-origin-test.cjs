const { io } = require('socket.io-client');
let ok = 0, fail = 0;
function attempt(n) {
  if (n > 5) { console.log('RESULT ok=' + ok + ' fail=' + fail); process.exit(fail ? 1 : 0); }
  const s = io('http://localhost:4000', { transports: ['websocket'], reconnection: false, extraHeaders: { Origin: 'http://localhost:4200' } });
  const t = setTimeout(() => { fail++; s.close(); attempt(n + 1); }, 2500);
  s.on('connect', () => { clearTimeout(t); ok++; s.close(); attempt(n + 1); });
  s.on('connect_error', (e) => { clearTimeout(t); console.log('ERR:', e.message); fail++; attempt(n + 1); });
}
attempt(1);