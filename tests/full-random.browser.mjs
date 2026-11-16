import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const money = value => value.toLocaleString('en-US') + 'k';

test('host selects full random, mobile guest sees the same board and terms after reload', async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    for (const page of [host, guest]) {
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
    }
    await host.goto(baseURL);
    await host.getByRole('textbox', { name: 'ВАШЕ ИМЯ' }).fill('пена');
    await host.getByRole('button', { name: 'Создать комнату' }).click();
    const mode = host.getByRole('radio', { name: 'Фулл рандом' });
    await mode.locator('..').click();
    await host.waitForFunction(() => document.querySelector('.price-tag')?.textContent === '?');
    await guest.goto(host.url());
    await guest.getByRole('textbox', { name: 'ВАШЕ ИМЯ' }).fill('Алиса');
    await guest.getByRole('button', { name: 'Присоединиться' }).click();
    await guest.getByText('Режим игры · Фулл рандом').waitFor();
    assert.equal(await guest.getByRole('radio').count(), 0);
    await host.getByRole('button', { name: 'Начать игру' }).click();
    const termsButton = { name: 'Фулл рандом — условия партии' };
    await host.getByRole('button', termsButton).waitFor();
    const code = new URL(host.url()).searchParams.get('room');
    const response = await host.request.get(baseURL + '/api/game', { params: { room: code } });
    assert.ok(response.ok());
    const { rules } = await response.json();
    await guest.reload();
    for (const page of [host, guest]) {
      await page.getByRole('button', termsButton).click();
      const terms = page.getByRole('dialog');
      assert.equal(await terms.locator('dt', { hasText: 'Стартовый капитал' }).locator('..').locator('dd').innerText(), money(rules.startingCash));
      await terms.locator('summary').click();
      const jackpot = rules.rouletteOutcomes.find(outcome => outcome.id === 'jackpot');
      assert.equal(await terms.locator('details dt', { hasText: 'Джекпот' }).locator('..').locator('dd').innerText(), jackpot.chance + '%');
      await terms.getByRole('button', { name: 'Закрыть' }).click();
      assert.deepEqual(await page.locator('.player-money').allTextContents(), [money(rules.startingCash), money(rules.startingCash)]);
      await page.getByRole('button', { name: 'Chanel, свободная компания' }).click();
      const card = page.getByRole('region', { name: 'Компания Chanel' });
      assert.equal(await card.locator('.property-meta b').first().innerText(), money(rules.tiles[1].price));
      assert.deepEqual(await card.locator('.rent-grid b').allTextContents(), rules.propertyRents[1].map(money));
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
