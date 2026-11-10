import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { GET } from '../app/api/game/route.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

test('game results show ranked cells and per-player laps on desktop and mobile', async () => {
  const game={code:'STATSUI',players:[
    {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0,turnsTaken:12,lapsCompleted:3},
    {id:'bob',name:'Боб',color:'#35aeeb',money:0,position:0,bankrupt:true,turnsTaken:8,lapsCompleted:1},
  ],host:'alice',started:true,turn:0,phase:'finished',winner:'alice',owners:{},mortgaged:[],dice:[],log:[],revision:1,
  tileVisits:{1:7,2:5,7:3,10:2}};
  globalThis.monopolyRooms.set(game.code,game);
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  try {
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      const context=await browser.newContext({viewport});
      await context.addInitScript(()=>localStorage.setItem('monopoly-player-id','alice'));
      await context.route('**/api/game*',async route=>{
        const request=route.request();const response=await GET(new Request(request.url(),{headers:request.headers()}));
        await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
      });
      const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(`${baseURL}/?room=${game.code}`);
      const results=page.getByRole('region',{name:'Самые посещаемые клетки'});await results.waitFor();
      const rows=results.locator('.top-tiles-row');assert.equal(await rows.count(),3);
      assert.match(await rows.nth(0).innerText(),/Chanel.*7/s);
      assert.match(await rows.nth(1).innerText(),/Шанс.*№3.*5/s);
      assert.match(await rows.nth(2).innerText(),/Шанс.*№8.*3/s);
      await page.locator('.player-card').filter({hasText:'Алиса'}).getByText('Кругов: 3').waitFor();
      assert.equal(await page.getByRole('button',{name:'Выйти из комнаты'}).isVisible(),true);
      const bounds=await results.boundingBox(),board=await page.locator('.board-center').boundingBox();
      assert.ok(bounds.x>=board.x&&bounds.x+bounds.width<=board.x+board.width);
      await context.close();
    }
  } finally {await browser.close();globalThis.monopolyRooms.delete(game.code)}
});
