import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { GET, POST } from '../app/api/game/route.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

test('chance skip is visible, confirmed once, and marked until the next turn', async () => {
  const game={code:'SKIPUI',players:[
    {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:2},
    {id:'bob',name:'Боб',color:'#35aeeb',money:15000,position:0},
  ],host:'alice',started:true,turn:0,phase:'chanceResult',owners:{},levels:{},turnSerial:1,mortgaged:[],dice:[1,1],rollSeq:1,log:[],revision:0,
    chanceResult:{id:'skip-turn',title:'Вынужденная пауза',description:'Вы пропускаете свой следующий ход.',amount:0,playerId:'alice',skipNextTurn:true}};
  globalThis.monopolyRooms.set(game.code,game);
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('monopoly-player-id','alice'));
    await context.route('**/api/game*',async route=>{
      const request=route.request();
      const response=await (request.method()==='GET'?GET(new Request(request.url(),{headers:request.headers()})):POST(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()})));
      await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(`${baseURL}/?room=${game.code}`);
    const dialog=page.getByRole('dialog',{name:'Вынужденная пауза'});
    await dialog.getByText('Вы пропускаете свой следующий ход.').waitFor();
    await dialog.getByRole('button',{name:'Продолжить',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await page.locator('.player-card').filter({hasText:'Алиса'}).getByText('Следующий ход пропущен').waitFor();
    assert.equal(game.players[0].skipNextTurn,true);assert.equal(game.turn,1);
  } finally {await browser.close();globalThis.monopolyRooms.delete(game.code)}
});
