import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../app/api/game/route';
import { CHANCE_CARDS, FULL_RANDOM_CARDS, drawChance } from '../lib/chance';
import { liquidFunds, playerCapital, propertyRent, propertyUpgradeCost, type Game } from '../lib/game';
import { generateRandomRules, mortgageValue, redemptionCost, rulesOf, upgradeResaleValue } from '../lib/rules';

const api = 'http://localhost/api/game';

function action(room: string, action: string, extra: Record<string, unknown> = {}, id = 'host') {
  return POST(new Request(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, action, id, ...extra }),
  }));
}

async function play(room: string, name: string, extra: Record<string, unknown> = {}, id = 'host'): Promise<Game> {
  const response = await action(room, name, extra, id);
  assert.equal(response.status, 200, name);
  return response.json();
}

async function lobby() {
  const { code } = await play('', 'create', { name: 'пена' });
  await play(code, 'join', { name: 'Алиса' }, 'guest');
  return code;
}

async function randomGame() {
  const code = await lobby();
  await play(code, 'setMode', { mode: 'fullRandom' });
  await play(code, 'start');
  return (globalThis as typeof globalThis & { monopolyRooms: Map<string, Game> }).monopolyRooms.get(code)!;
}

test('the host locks one server-generated economy for the whole room, including bots and reconnects', async () => {
  const code = await lobby();
  for (const [mode, id] of [['fullRandom', 'guest'], ['invalid', 'host']]) {
    assert.ok((await action(code, 'setMode', { mode }, id)).status >= 400);
  }
  await play(code, 'addBot');
  const selection = await play(code, 'setMode', { mode: 'fullRandom' });
  assert.equal(selection.rules, undefined);
  const game = await play(code, 'start', { rules: { startingCash: 999999 } });
  assert.equal(game.mode, 'fullRandom');
  const rules = game.rules!;
  assert.ok(rules.startingCash >= 10000 && rules.startingCash <= 20000);
  assert.deepEqual(game.players.map(p => p.money), Array(3).fill(rules.startingCash));
  assert.ok((await action(code, 'setMode', { mode: 'classic' })).status >= 400);
  assert.ok((await action(code, 'start')).status >= 400);
  const loan = await play(code, 'loanTake');
  assert.deepEqual(loan.rules, rules);
  const rejoined = await play(code, 'join', { name: 'пена' });
  assert.equal(rejoined.players[0].money, rules.startingCash + rules.loanPrincipal);
  const guestView: Game = await (await GET(new Request(api + '?room=' + code + '&id=guest'))).json();
  assert.deepEqual(guestView.rules, rules);
  const other = await lobby();
  await play(other, 'setMode', { mode: 'fullRandom' });
  await play(other, 'setMode', { mode: 'classic' });
  const classic = await play(other, 'start');
  assert.deepEqual(classic.players.map(p => p.money), [15000, 15000]);
  assert.deepEqual(rulesOf(classic), rulesOf());
});

test('random economies retain increasing rents, sensible buybacks and valid wheel probabilities', () => {
  const classic = structuredClone(rulesOf());
  let seed = 31;
  const seeded = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const random of [() => 0, () => 0.999999, ...Array(80).fill(seeded)]) {
    const rules = generateRandomRules(random);
    assert.ok(rules.taxFee >= 1800 && rules.taxFee <= 2000);
    assert.ok(rules.diamondFee >= 900 && rules.diamondFee <= 1000);
    assert.ok(rules.landOnStart > rules.passStart);
    assert.ok(rules.loanTotalDue > rules.loanPrincipal);
    assert.ok(rules.jackpotPayouts[1] > rules.jackpotPayouts[2] && rules.jackpotPayouts[2] > rules.jackpotPayouts[3]);
    assert.equal(rules.rouletteOutcomes.reduce((sum, entry) => sum + entry.chance, 0), 100);
    const wheelJackpot = rules.rouletteOutcomes.find(entry => entry.id === 'jackpot')!;
    assert.ok(wheelJackpot.chance > 0 && wheelJackpot.chance < 10);
    for (const [index, tile] of rules.tiles.entries()) {
      if (!tile.price) continue;
      assert.ok(tile.price > 0 && tile.price < rules.startingCash);
      assert.ok(redemptionCost(tile.price, rules) > mortgageValue(tile.price, rules));
      if (!propertyRent(index, 0, rules)) continue;
      for (let tier = 0; tier < 6; tier++) {
        assert.ok(propertyRent(index, tier + 1, rules) > propertyRent(index, tier, rules));
      }
    }
  }
  assert.notDeepEqual(generateRandomRules(() => 0), generateRandomRules(() => 0.999999));
  assert.deepEqual(rulesOf(), classic);
});

test('buying, rent, improvement, liquidation and buyback all use the same room prices', async t => {
  const game = await randomGame();
  const rules = game.rules!;
  const host = game.players[0];
  const price = rules.tiles[1].price!;
  const cost = propertyUpgradeCost(1, 0, rules);
  game.phase = 'buy';
  host.position = 1;
  await play(game.code, 'buy');
  assert.equal(host.money, rules.startingCash - price);
  assert.equal(playerCapital(game, host), rules.startingCash);
  game.turn = 0;
  game.owners[3] = host.id;
  await play(game.code, 'upgrade', { tile: 1 });
  assert.equal(host.money, rules.startingCash - price - cost);
  const liquid = liquidFunds(game, host);
  await play(game.code, 'sellUpgrade', { tile: 1 });
  assert.equal(host.money, rules.startingCash - price - cost + upgradeResaleValue(cost, rules));
  await play(game.code, 'mortgage', { tile: 1 });
  assert.equal(game.mortgageTurns![1], rules.mortgageTurns);
  assert.equal(liquidFunds(game, host), liquid);
  const beforeBuyback = host.money;
  await play(game.code, 'unmortgage', { tile: 1 });
  assert.equal(host.money, beforeBuyback - redemptionCost(price, rules));
  game.turn = 1;
  game.players[1].position = 39;
  t.mock.method(Math, 'random', () => 0); // 1+1, crosses Start and lands on Chanel.
  const landed = await play(game.code, 'roll', {}, 'guest');
  assert.equal(landed.debt?.amount, propertyRent(1, 1, rules));
  assert.equal(landed.players[1].money, rules.startingCash + rules.passStart);
});

test('the portal reveals its destination once, triggers a mine and never pays a lap bonus', async t => {
  const game = await randomGame();
  const host = game.players[0];
  host.position = 38;
  for (const [i, tile] of game.rules!.tiles.entries()) {
    if (tile.price && i !== 3) game.owners[i] = 'guest';
  }
  const portalIndex = FULL_RANDOM_CARDS.findIndex(card => card.id === 'portal');
  assert.ok(portalIndex >= 0);
  assert.ok(!CHANCE_CARDS.some(card => card.id === 'portal'));
  t.mock.method(Math, 'random', () => (portalIndex + 0.5) / FULL_RANDOM_CARDS.length);
  game.chanceResult = drawChance(game, host);
  assert.equal(game.chanceResult.destination, 3);
  game.traps = [{ id: 'mine', ownerId: 'guest', tile: 3, amount: 500, cost: 200, placedAfter: {} }];
  game.phase = 'chanceResult';
  const moved = await play(game.code, 'chanceContinue');
  assert.equal(moved.players[0].position, 3);
  assert.equal(moved.players[0].money, game.rules!.startingCash);
  assert.equal(moved.players[0].lapsCompleted ?? 0, 0);
  assert.equal(moved.debt?.kind, 'trap');
  assert.ok((await action(game.code, 'chanceContinue')).status >= 400);
  game.animationUntil = 0;
  assert.equal((await play(game.code, 'pay')).phase, 'buy');
  game.owners[3] = 'guest';
  assert.equal(drawChance(game, host).destination, undefined);
});

test('landing charges the published capped fees and picks each jackpot game at the room threshold', async t => {
  const game = await randomGame();
  const rules = game.rules!;
  let draws: number[] = [];
  t.mock.method(Math, 'random', () => draws.shift() ?? 0);
  async function land(tile: number, ticket = 0) {
    game.phase = 'roll';
    game.turn = 0;
    game.players[0].position = tile - 3;
    game.animationUntil = 0;
    draws = [0, 0.2, ticket]; // 1 + 2.
    return play(game.code, 'roll');
  }
  for (const [tile, fee] of [[4, rules.taxFee], [36, rules.diamondFee]]) {
    const cashBefore = game.players[0].money;
    assert.equal((await land(tile)).debt?.amount, fee);
    game.animationUntil = 0;
    assert.equal((await play(game.code, 'pay')).players[0].money, cashBefore - fee);
  }
  assert.equal((await land(20, (rules.numberGamePercent - 0.5) / 100)).phase, 'jackpot');
  assert.equal((await land(20, (rules.numberGamePercent + 0.5) / 100)).phase, 'roulette');
});

test('position swap, mirror and gift apply their revealed effects exactly once', async t => {
  const game = await randomGame();
  const [host, guest] = game.players;
  const rules = game.rules!;
  let ticket = 0;
  t.mock.method(Math, 'random', () => ticket);
  const reveal = (effect: NonNullable<Game['chanceResult']>['effect']) => {
    const index = FULL_RANDOM_CARDS.findIndex(card => card.effect === effect);
    assert.ok(index >= 0);
    ticket = (index + 0.5) / FULL_RANDOM_CARDS.length;
    game.turn = 0;
    game.phase = 'chanceResult';
    game.chanceResult = drawChance(game, host);
    assert.equal(game.chanceResult.effect, effect);
    return game.chanceResult;
  };
  host.position = 2;
  guest.position = 36;
  assert.equal(reveal('swapPositions').targetPlayerId, guest.id);
  await play(game.code, 'chanceContinue');
  assert.deepEqual(game.players.map(p => [p.position, p.money]), [[36, rules.startingCash], [2, rules.startingCash]]);
  assert.equal(game.debt, undefined);
  assert.ok((await action(game.code, 'chanceContinue')).status >= 400);
  guest.jailed = true;
  assert.equal(reveal('swapPositions').targetPlayerId, undefined);
  await play(game.code, 'chanceContinue');
  assert.equal(host.position, 36);
  guest.jailed = false;

  reveal('reverseAll');
  await play(game.code, 'chanceContinue');
  assert.ok(host.reverseNextMove && guest.reverseNextMove);
  const gift = reveal('giftProperty');
  const chosen = gift.destination!;
  assert.ok(rules.tiles[chosen].price);
  ticket = 0; // Confirmation must use the company shown on the card.
  await play(game.code, 'chanceContinue');
  assert.equal(game.owners[chosen], host.id);
  assert.equal(host.money, rules.startingCash);
  assert.ok((await action(game.code, 'chanceContinue')).status >= 400);
  assert.deepEqual(Object.keys(game.owners), [String(chosen)]);
});
