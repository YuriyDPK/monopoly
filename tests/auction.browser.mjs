import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { GET, POST } from '../app/api/game/route.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

test('auction: 100k slider, competing bids, cash limits and old bids on desktop and mobile', async t => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
  });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const game = {
        code: `AUCTIONUI${viewport.width}`, host: 'alice', started: true, turn: 0, turnSerial: 1, phase: 'auction',
        players: [
          { id: 'alice', name: 'Алиса', color: '#ed515b', money: 10000, position: 1 },
          { id: 'bob', name: 'Боб', color: '#35aeeb', money: 10000, position: 0 },
          { id: 'cara', name: 'Кара', color: '#95ca50', money: 1999, position: 0 },
        ],
        owners: {}, levels: {}, lastUpgradeTurn: {}, mortgaged: [], mortgageTurns: {}, dice: [], log: [], revision: 0,
        auction: { tile: 1, bid: 600, bidder: 'bob', passed: ['alice'], seller: 'alice' },
      };
      globalThis.monopolyRooms.set(game.code, game);
      const context = await browser.newContext({ viewport });
      const errors = [], actions = [];
      await context.addInitScript(() => localStorage.setItem('monopoly-player-id', 'cara'));
      await context.route('**/api/game*', async route => {
        const request = route.request();
        if (request.method() === 'POST') actions.push(request.postDataJSON());
        const response = request.method() === 'GET'
          ? await GET(new Request(request.url(), { headers: request.headers() }))
          : await POST(new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postData() }));
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const slider = page.locator('#auction-bid');
      const submit = page.getByRole('button', { name: 'Ставка', exact: true });

      async function bob(action, extra = {}) {
        const response = await POST(new Request(`${baseURL}/api/game`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, room: game.code, id: 'bob', ...extra }),
        }));
        assert.equal(response.status, 200, await response.text());
      }

      try {
        await page.goto(`${baseURL}/?room=${game.code}`);
        await slider.waitFor();
        assert.equal(await slider.getAttribute('min'), '700');
        assert.equal(await slider.getAttribute('step'), '100');
        assert.equal(await slider.getAttribute('max'), '1900', 'A 1999k balance must cap the slider at 1900k');
        assert.equal(await slider.inputValue(), '700');
        assert.match(await page.locator('.auction-range').innerText(), /Шаг 100k/);
        await slider.focus();
        await slider.press('ArrowRight');
        assert.equal(await slider.inputValue(), '800', 'One arrow press must raise the offer by exactly 100k');
        await submit.click();
        await slider.waitFor({ state: 'hidden' });
        assert.equal(game.auction.bid, 800);assert.equal(game.auction.bidder, 'cara');
        assert.equal(game.players[2].money, 1999, 'The bid is charged only when the auction ends');
        assert.equal(actions.at(-1).amount, 800);

        await bob('bid', { amount: 1000 });
        await page.waitForFunction(() => document.querySelector('#auction-bid')?.min === '1100');
        assert.equal(await slider.inputValue(), '1100', 'A competing bid must update the selected minimum through polling');
        assert.equal(await slider.getAttribute('step'), '100');
        assert.equal(await slider.getAttribute('max'), '1900');
        await slider.focus();await slider.press('End');
        assert.equal(await slider.inputValue(), '1900');
        await slider.press('Home');
        assert.equal(await slider.inputValue(), '1100');
        if (process.env.AUCTION_SCREENSHOT) {
          await page.locator('.board-wrap').screenshot({ path: process.env.AUCTION_SCREENSHOT.replace(/\.png$/, `.${viewport.width}.png`) });
        }
        await submit.click();await slider.waitFor({ state: 'hidden' });
        assert.equal(game.auction.bid, 1100);assert.equal(game.auction.bidder, 'cara');
        await bob('pass');
        await page.locator('.phase-auction').waitFor({ state: 'hidden' });
        assert.equal(game.auction, undefined);assert.equal(game.owners[1], 'cara');
        assert.deepEqual(game.players.map(player => player.money), [10000, 10000, 899]);
        assert.deepEqual(actions.filter(action => action.action === 'bid').map(action => action.amount), [800, 1100]);

        // Restore a saved auction with a pre-update 650k bid and a non-rounded cash balance.
        game.phase = 'auction';game.turn = 0;game.players[0].position = 3;
        game.auction = { tile: 3, bid: 650, bidder: 'bob', passed: ['alice'], seller: 'alice' };
        game.revision++;
        await page.reload();await slider.waitFor();
        assert.equal(await slider.getAttribute('min'), '800', '650k must not be raised to 700k after the update');
        assert.equal(await slider.getAttribute('max'), '800');
        assert.equal(await slider.getAttribute('step'), '100');
        assert.equal(await slider.inputValue(), '800');
        await submit.click();await slider.waitFor({ state: 'hidden' });
        assert.equal(game.auction.bid, 800);assert.equal(game.auction.bidder, 'cara');
        assert.equal(game.players[2].money, 899);
        assert.deepEqual(errors, []);
      } catch (error) {
        t.diagnostic(`Viewport: ${viewport.width}x${viewport.height}`);
        t.diagnostic(await page.locator('body').innerText());
        t.diagnostic(JSON.stringify({ errors, actions, game }));
        throw error;
      } finally {
        await context.close();globalThis.monopolyRooms.delete(game.code);
      }
    }
  } finally {
    await browser.close();
  }
});
