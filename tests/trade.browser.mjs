import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { GET, POST } from '../app/api/game/route.ts';
import { tiles } from '../lib/game.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

test('trades: negotiate twice, preserve drafts, reload, accept, decline and cancel on desktop and mobile', async t => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  const game = {
    code: 'TRADEUI',
    players: [
      { id: 'alice', name: 'Алиса', color: '#ed515b', money: 15000, position: 0 },
      { id: 'bob', name: 'Боб', color: '#35aeeb', money: 15000, position: 0 },
      { id: 'cara', name: 'Кара', color: '#95ca50', money: 15000, position: 0 },
    ],
    host: 'alice', started: true, turn: 0, phase: 'roll',
    owners: { 37: 'alice', 39: 'bob' }, levels: {}, turnSerial: 1, lastUpgradeTurn: {},
    mortgaged: [], mortgageTurns: {}, dice: [], log: [], revision: 0,
  };
  globalThis.monopolyRooms.set(game.code, game);
  const pages = [], errors = [], actions = [];

  async function player(id, viewport) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(playerId => localStorage.setItem('monopoly-player-id', playerId), id);
    await context.route('**/api/game*', async route => {
      const request = route.request();
      if (request.method() === 'POST') actions.push(request.postDataJSON());
      const response = request.method() === 'GET'
        ? await GET(new Request(request.url(), { headers: request.headers() }))
        : await POST(new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postData() }));
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    const page = await context.newPage();
    pages.push(page);
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${baseURL}/?room=${game.code}`);
    await page.locator('.player-card').filter({ hasText: 'Алиса' }).waitFor();
    return page;
  }

  const dialog = (page, name) => page.getByRole('dialog', { name, exact: true });
  const incoming = page => dialog(page, 'Входящий договор');
  const outgoing = page => dialog(page, 'Исходящий договор');
  const counter = page => dialog(page, 'Встречное предложение');
  const offeredCash = panel => panel.getByRole('spinbutton', { name: 'Вы предлагаете деньги', exact: true });
  const requestedCash = panel => panel.getByRole('spinbutton', { name: 'Игрок отдаёт деньги', exact: true });
  const property = (page, company, owner) => page.locator(`.property-cell[aria-label="${company}, владелец ${owner}"]`);
  const snapshot = () => ({ money: game.players.map(player => player.money), owners: { ...game.owners } });

  async function singleDialog(page, name) {
    const panel = dialog(page, name);
    await panel.waitFor();
    assert.equal(await page.locator('[role="dialog"]:visible').count(), 1, 'Trade dialogs must not overlap');
    return panel;
  }

  async function insideBoard(page, name) {
    const panel = await singleDialog(page, name);
    const bounds = await panel.boundingBox(), board = await page.locator('.board-center').boundingBox();
    assert.ok(bounds && board);
    assert.ok(bounds.x >= board.x - 1 && bounds.y >= board.y - 1
      && bounds.x + bounds.width <= board.x + board.width + 1
      && bounds.y + bounds.height <= board.y + board.height + 1, `${name} must fit inside the board`);
    assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'No horizontal overflow in trade panel');
    return panel;
  }

  async function nextPoll(page) {
    await page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/api/game'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  async function newOffer(alice, amount = '100') {
    await alice.locator('.player-card').filter({ hasText: 'Боб' }).click();
    const editor = await singleDialog(alice, 'Договор');
    await offeredCash(editor).fill(amount);
    return editor;
  }

  try {
    const alice = await player('alice', { width: 1440, height: 1000 });
    const bob = await player('bob', { width: 390, height: 844 });
    const cara = await player('cara', { width: 1280, height: 900 });
    const originalAssets = snapshot();

    const editor = await newOffer(alice, '3000');
    await property(alice, tiles[39].name, 'Боб').click();
    await editor.getByRole('button', { name: 'Предложить сделку', exact: true }).click();
    await singleDialog(alice, 'Исходящий договор');
    await insideBoard(bob, 'Входящий договор');
    const firstId = game.trade.id;
    assert.deepEqual({ ...game.trade, id: undefined }, {
      id: undefined, from: 'alice', to: 'bob', give: [], take: [39], giveCash: 3000, takeCash: 0,
    });
    assert.deepEqual(snapshot(), originalAssets, 'Offering must not reserve or transfer money/property');
    assert.equal(await cara.getByRole('dialog').count(), 0);

    await incoming(bob).getByRole('button', { name: 'Изменить условия', exact: true }).click();
    let counterEditor = await insideBoard(bob, 'Встречное предложение');
    assert.equal(await offeredCash(counterEditor).inputValue(), '');
    assert.equal(await requestedCash(counterEditor).inputValue(), '3000');
    assert.match(await property(bob, tiles[39].name, 'Боб').getAttribute('class'), /trade-selected/);
    await requestedCash(counterEditor).fill('4000');
    await property(bob, tiles[37].name, 'Алиса').click();
    await nextPoll(bob);
    assert.equal(await requestedCash(counterEditor).inputValue(), '4000', 'Polling must retain the edited amount');
    assert.match(await property(bob, tiles[37].name, 'Алиса').getAttribute('class'), /trade-selected/);
    assert.deepEqual(snapshot(), originalAssets);
    if (process.env.TRADE_SCREENSHOT) await bob.screenshot({ path: process.env.TRADE_SCREENSHOT.replace(/\.png$/, '.editor.mobile.png') });

    await counterEditor.getByRole('button', { name: 'Отправить встречное предложение', exact: true }).click();
    await insideBoard(bob, 'Исходящий договор');
    await singleDialog(alice, 'Входящий договор');
    const secondId = game.trade.id;
    assert.notEqual(secondId, firstId);
    assert.deepEqual(game.trade, {
      id: secondId, counterOf: firstId, from: 'bob', to: 'alice',
      give: [39], take: [37], giveCash: 0, takeCash: 4000,
    });
    assert.deepEqual(snapshot(), originalAssets);
    if (process.env.TRADE_SCREENSHOT) await bob.screenshot({ path: process.env.TRADE_SCREENSHOT.replace(/\.png$/, '.outgoing.mobile.png') });

    await bob.reload();
    await insideBoard(bob, 'Исходящий договор');
    await alice.reload();
    await singleDialog(alice, 'Входящий договор');
    assert.match(await incoming(alice).innerText(), /4,000k/);
    assert.equal(game.trade.id, secondId, 'Reload must preserve the current offer');
    await incoming(alice).getByRole('button', { name: 'Закрыть договор', exact: true }).click();
    await incoming(alice).waitFor({ state: 'hidden' });
    await alice.getByRole('button', { name: 'Открыть предложение о сделке', exact: true }).click();
    await singleDialog(alice, 'Входящий договор');

    await incoming(alice).getByRole('button', { name: 'Изменить условия', exact: true }).click();
    counterEditor = await singleDialog(alice, 'Встречное предложение');
    assert.equal(await offeredCash(counterEditor).inputValue(), '4000');
    assert.equal(await requestedCash(counterEditor).inputValue(), '');
    await offeredCash(counterEditor).fill('3500');
    await counterEditor.getByRole('button', { name: 'Отправить встречное предложение', exact: true }).click();
    await singleDialog(alice, 'Исходящий договор');
    await insideBoard(bob, 'Входящий договор');
    const thirdId = game.trade.id;
    assert.notEqual(thirdId, secondId);
    assert.deepEqual(game.trade, {
      id: thirdId, counterOf: secondId, from: 'alice', to: 'bob',
      give: [37], take: [39], giveCash: 3500, takeCash: 0,
    });
    assert.deepEqual(snapshot(), originalAssets);
    await incoming(bob).getByRole('button', { name: 'Принять', exact: true }).click();
    await incoming(bob).waitFor({ state: 'hidden' });
    await outgoing(alice).waitFor({ state: 'hidden' });
    assert.equal(game.trade, undefined);
    assert.deepEqual(snapshot(), { money: [11500, 18500, 15000], owners: { 37: 'bob', 39: 'alice' } });
    assert.equal(game.turn, 0);
    assert.equal(game.phase, 'roll');
    assert.equal(actions.filter(action => action.action === 'tradeResponse' && action.accept).length, 1);
    const tradedAssets = snapshot();

    const cancelEditor = await newOffer(alice);
    await cancelEditor.getByRole('button', { name: 'Предложить сделку', exact: true }).click();
    await singleDialog(alice, 'Исходящий договор');
    await incoming(bob).getByRole('button', { name: 'Изменить условия', exact: true }).click();
    counterEditor = await singleDialog(bob, 'Встречное предложение');
    await requestedCash(counterEditor).fill('250');
    await nextPoll(bob);
    assert.equal(await requestedCash(counterEditor).inputValue(), '250');
    const countersBeforeCancel = actions.filter(action => action.action === 'tradeCounter').length;
    await outgoing(alice).getByRole('button', { name: 'Отменить предложение', exact: true }).click();
    await counter(bob).waitFor({ state: 'hidden' });
    await outgoing(alice).waitFor({ state: 'hidden' });
    assert.equal(game.trade, undefined);
    assert.equal(actions.filter(action => action.action === 'tradeCounter').length, countersBeforeCancel);
    assert.deepEqual(snapshot(), tradedAssets);

    const declineEditor = await newOffer(alice, '200');
    await declineEditor.getByRole('button', { name: 'Предложить сделку', exact: true }).click();
    await incoming(bob).getByRole('button', { name: 'Изменить условия', exact: true }).click();
    await singleDialog(bob, 'Встречное предложение');
    await counter(bob).getByRole('button', { name: 'Назад к предложению', exact: true }).click();
    await singleDialog(bob, 'Входящий договор');
    await incoming(bob).getByRole('button', { name: 'Отклонить', exact: true }).click();
    await incoming(bob).waitFor({ state: 'hidden' });
    await outgoing(alice).waitFor({ state: 'hidden' });
    assert.equal(game.trade, undefined);
    assert.deepEqual(snapshot(), tradedAssets);

    const surrenderEditor = await newOffer(alice, '100');
    await surrenderEditor.getByRole('button', { name: 'Предложить сделку', exact: true }).click();
    await incoming(bob).getByRole('button', { name: 'Изменить условия', exact: true }).click();
    await singleDialog(bob, 'Встречное предложение');
    await bob.locator('.player-card').filter({ hasText: 'Боб' }).click();
    const surrender = await singleDialog(bob, 'Сдаться');
    assert.equal(await counter(bob).count(), 0, 'Surrender must replace the counteroffer editor');
    await surrender.getByRole('button', { name: 'Продолжить игру', exact: true }).click();
    await singleDialog(bob, 'Входящий договор');
    await outgoing(alice).getByRole('button', { name: 'Отменить предложение', exact: true }).click();
    await incoming(bob).waitFor({ state: 'hidden' });
    await outgoing(alice).waitFor({ state: 'hidden' });
    assert.equal(game.trade, undefined);
    assert.deepEqual(snapshot(), tradedAssets);

    const tradeMutations = actions.filter(action => ['tradeCounter', 'tradeResponse', 'cancelTrade'].includes(action.action));
    assert.ok(tradeMutations.length >= 5);
    for (const action of tradeMutations) assert.equal(typeof action.tradeId, 'string', `${action.action} must carry its offer ID`);
    assert.deepEqual(actions.filter(action => action.action === 'tradeCounter').map(action => action.tradeId), [firstId, secondId]);
    for (const page of pages) assert.equal(await page.locator('[role="dialog"]:visible').count(), 0);
    assert.deepEqual(errors, []);
  } catch (error) {
    for (const page of pages) if (!page.isClosed()) t.diagnostic(await page.locator('body').innerText());
    t.diagnostic(JSON.stringify({ errors, actions }));
    throw error;
  } finally {
    await browser.close();
    globalThis.monopolyRooms.delete(game.code);
  }
});
