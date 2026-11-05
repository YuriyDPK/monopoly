import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.argv[2];
if (!base) throw new Error('Usage: node deploy/smoke-test.mjs <base-url>');
let response;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    response = await fetch(base, { signal: AbortSignal.timeout(2000) });
    if (response.ok) break;
  } catch { /* The server may still be starting. */ }
  await delay(1000);
}
assert.ok(response?.ok, 'The game page did not become available');
assert.match(await response.text(), /MONOPOLY/);
assert.ok((await fetch(`${base}/board-reference.png`)).ok, 'The board image is unavailable');
const player = randomUUID(), opponent = randomUUID();
async function action(body) {
  const result = await fetch(`${base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(result.ok, `Game action ${body.action} failed with status ${result.status}`);
  return result.json();
}
const room = await action({ action: 'create', id: player, name: 'Smoke test' });
await action({ action: 'join', room: room.code, id: opponent, name: 'Smoke test 2' });
const started = await action({ action: 'start', room: room.code, id: player });
assert.equal(started.started, true);
const stateResponse = await fetch(`${base}/api/game?room=${encodeURIComponent(room.code)}`);
assert.ok(stateResponse.ok);
const state = await stateResponse.json();
assert.equal(state.players.length, 2);
assert.equal(state.phase, 'roll');
console.log('Smoke test passed: page, board, room creation, joining and game start');
