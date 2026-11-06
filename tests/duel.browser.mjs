import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { GET, POST } from '../app/api/game/route.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL=process.env.BASE_URL||'http://localhost:3000';

test('duel: adjustable stake, shared invitation and result, consent, payout, decline, cancellation and bot', async t=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const game={code:'DUELUI',players:[
    {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0},
    {id:'bob',name:'Боб',color:'#35aeeb',money:1500,position:0},
    {id:'cara',name:'Кара',color:'#95ca50',money:3000,position:0},
  ],host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0};
  globalThis.monopolyRooms.set(game.code,game);
  const pages=[],errors=[],actions=[];
  async function player(id,viewport){
    const context=await browser.newContext({viewport});
    await context.addInitScript(id=>localStorage.setItem('monopoly-player-id',id),id);
    await context.route('**/api/game*',async route=>{
      const request=route.request();let response;
      if(request.method()==='GET')response=await GET(new Request(request.url()));
      else{
        const body=request.postDataJSON();actions.push(body);
        const values=body.action==='duelRespond'?[0.34,0.68,0.17,0.51]:[];
        const random=mock.method(Math,'random',()=>values.shift()??0);
        try{response=await POST(new Request(request.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))}
        finally{random.mock.restore()}
      }
      await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    const page=await context.newPage();pages.push(page);page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.goto(`${baseURL}/?room=${game.code}`);return page;
  }
  async function insideBoard(page,name='Дуэль'){
    const panel=page.getByRole('region',{name,exact:true});await panel.waitFor();
    const bounds=await panel.boundingBox(),square=await page.locator('.board-center').boundingBox();
    assert.ok(bounds.x>=square.x&&bounds.y>=square.y&&bounds.x+bounds.width<=square.x+square.width+1&&bounds.y+bounds.height<=square.y+square.height+1);
    return panel;
  }
  try{
    const alice=await player('alice',{width:1440,height:1000});
    const bob=await player('bob',{width:390,height:844});
    const cara=await player('cara',{width:1280,height:900});
    await cara.locator('.player-card').filter({hasText:'Боб'}).click();
    await cara.getByRole('dialog',{name:'Договор',exact:true}).waitFor();
    await bob.getByRole('button',{name:'Взять кредит',exact:true}).click();
    await bob.getByRole('dialog',{name:'Кредит на развитие',exact:true}).waitFor();
    await alice.locator('.player-card').filter({hasText:'Боб'}).click();
    await alice.getByRole('dialog',{name:'Договор',exact:true}).getByRole('button',{name:'Дуэль',exact:true}).click();
    const setup=alice.getByRole('region',{name:'Настройка дуэли',exact:true});await setup.waitFor();
    await alice.setViewportSize({width:390,height:844});await insideBoard(alice,'Настройка дуэли');
    if(process.env.DUEL_SCREENSHOT)await alice.screenshot({path:process.env.DUEL_SCREENSHOT.replace(/\.png$/,'.setup.mobile.png')});
    await setup.getByRole('combobox',{name:'Соперник дуэли'}).selectOption('bob');
    const stake=setup.getByRole('spinbutton',{name:'Ставка дуэли',exact:true});
    assert.equal(await stake.getAttribute('min'),'100');assert.equal(await stake.getAttribute('max'),'1500');
    await stake.fill('700');
    const slider=setup.getByRole('slider',{name:'Ставка дуэли ползунок'});
    assert.equal(await slider.inputValue(),'700');await slider.focus();await slider.press('ArrowRight');
    assert.equal(await stake.inputValue(),'800');await stake.fill('700');
    await alice.setViewportSize({width:1440,height:1000});
    await setup.getByRole('button',{name:'Вызвать на дуэль',exact:true}).click();
    const invitation=await insideBoard(bob);await insideBoard(cara);
    await cara.getByRole('dialog',{name:'Договор',exact:true}).waitFor({state:'hidden'});
    await bob.getByRole('dialog',{name:'Кредит на развитие',exact:true}).waitFor({state:'hidden'});
    assert.match(await invitation.innerText(),/700k/);
    assert.deepEqual(game.players.map(p=>p.money),[15000,1500,3000]);
    assert.equal(await cara.getByRole('button',{name:'Принять за 700k',exact:true}).count(),0);
    assert.equal(await alice.getByRole('button',{name:'Принять за 700k',exact:true}).count(),0);
    await bob.getByRole('button',{name:'Принять за 700k',exact:true}).click();
    for(const page of [alice,bob,cara])await page.getByRole('status').filter({hasText:'Алиса побеждает'}).waitFor();
    assert.deepEqual(game.duel.dice,[[3,5],[2,4]]);
    assert.deepEqual(game.players.map(p=>p.money),[14300,800,3000]);
    assert.equal(await bob.getByRole('button',{name:'Продолжить',exact:true}).count(),0);
    await bob.reload();await bob.getByRole('status').filter({hasText:'Алиса побеждает'}).waitFor();
    assert.deepEqual(game.duel.dice,[[3,5],[2,4]]);
    if(process.env.DUEL_SCREENSHOT){
      await alice.screenshot({path:process.env.DUEL_SCREENSHOT});
      await bob.screenshot({path:process.env.DUEL_SCREENSHOT.replace(/\.png$/,'.mobile.png')});
    }
    await alice.getByRole('button',{name:'Продолжить',exact:true}).click();
    await alice.getByRole('button',{name:'Бросить кубики'}).waitFor();
    assert.deepEqual(game.players.map(p=>p.money),[15700,800,3000]);
    assert.equal(game.turn,0);assert.deepEqual(game.dice,[]);assert.equal(game.players[0].position,0);
    await alice.locator('.player-card').filter({hasText:'Боб'}).click();
    assert.equal(await alice.getByRole('dialog',{name:'Договор',exact:true}).getByRole('button',{name:'Дуэль',exact:true}).isDisabled(),true);
    assert.equal(actions.filter(action=>action.action==='duelRespond').length,1);

    async function fresh(){game.turnSerial++;game.lastDuelTurn=undefined;game.duel=undefined;game.phase='roll';game.animationUntil=0;game.players[1].money=1500;game.revision++;await alice.reload()}
    async function challenge(){
      await alice.locator('.player-card').filter({hasText:'Боб'}).click();
      await alice.getByRole('dialog',{name:'Договор',exact:true}).getByRole('button',{name:'Дуэль',exact:true}).click();
      await alice.getByRole('spinbutton',{name:'Ставка дуэли',exact:true}).fill('500');
      await alice.getByRole('button',{name:'Вызвать на дуэль',exact:true}).click();
    }
    await fresh();await challenge();await bob.getByRole('button',{name:'Отказаться',exact:true}).click();
    await alice.getByRole('button',{name:'Бросить кубики'}).waitFor();
    assert.equal(game.players[0].money,15700);assert.equal(game.players[1].money,1500);
    await fresh();await challenge();await alice.getByRole('button',{name:'Отменить вызов',exact:true}).click();
    await alice.getByRole('button',{name:'Бросить кубики'}).waitFor();
    assert.equal(game.players[0].money,15700);assert.equal(game.players[1].money,1500);
    await fresh();game.players[1].bot=true;game.revision++;await alice.reload();await challenge();
    await alice.getByRole('status').filter({hasText:/побеждает|Ничья/}).waitFor();
    assert.equal(game.phase,'duelResult');assert.ok(game.duel.dice);
    await alice.getByRole('button',{name:'Продолжить',exact:true}).click();
    await alice.getByRole('button',{name:'Бросить кубики'}).waitFor();
    assert.equal(game.players.reduce((sum,p)=>sum+p.money,0),20200);
    assert.deepEqual(errors,[]);
  }catch(error){for(const page of pages)if(!page.isClosed())t.diagnostic(await page.locator('body').innerText());t.diagnostic(JSON.stringify({errors,actions}));throw error}
  finally{await browser.close();globalThis.monopolyRooms.delete(game.code)}
});

test('duel: player card opens the duel button and selects that opponent on desktop and mobile', async t=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  try{
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      const game={code:`DUELCARD${viewport.width}`,players:[
        {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0},
        {id:'bob',name:'Боб',color:'#35aeeb',money:3000,position:0},
        {id:'cara',name:'Кара',color:'#95ca50',money:900,position:0},
      ],host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0};
      globalThis.monopolyRooms.set(game.code,game);
      const context=await browser.newContext({viewport}),actions=[],errors=[];
      await context.addInitScript(()=>localStorage.setItem('monopoly-player-id','alice'));
      await context.route('**/api/game*',async route=>{
        const request=route.request();
        if(request.method()==='POST')actions.push(request.postDataJSON());
        const response=await (request.method()==='GET'?GET(new Request(request.url())):POST(new Request(request.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:request.postData()})));
        await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
      });
      const page=await context.newPage();page.setDefaultTimeout(10000);
      page.on('pageerror',error=>errors.push(error.message));
      try{
        await page.goto(`${baseURL}/?room=${game.code}`);
        const card=name=>page.locator('.player-card').filter({hasText:name});
        await card('Кара').click();
        const dialog=page.getByRole('dialog',{name:'Договор',exact:true});await dialog.waitFor();
        const duelButton=dialog.getByRole('button',{name:'Дуэль',exact:true});await duelButton.waitFor();
        assert.equal(await duelButton.isEnabled(),true);
        if(process.env.DUEL_PLAYER_SCREENSHOT)await page.screenshot({path:process.env.DUEL_PLAYER_SCREENSHOT.replace(/\.png$/,`.${viewport.width}.png`)});
        await duelButton.click();
        const setup=page.getByRole('region',{name:'Настройка дуэли',exact:true});await setup.waitFor();
        await dialog.waitFor({state:'hidden'});
        assert.equal(await setup.getByRole('combobox',{name:'Соперник дуэли'}).inputValue(),'cara');
        assert.equal(await setup.getByRole('spinbutton',{name:'Ставка дуэли',exact:true}).getAttribute('max'),'900');
        await setup.getByRole('spinbutton',{name:'Ставка дуэли',exact:true}).fill('700');
        await setup.getByRole('button',{name:'Вызвать на дуэль',exact:true}).click();
        await page.getByRole('region',{name:'Дуэль',exact:true}).waitFor();
        assert.equal(game.duel.to,'cara');assert.equal(game.duel.bet,700);
        assert.deepEqual(game.players.map(p=>p.money),[15000,3000,900]);
        await page.getByRole('button',{name:'Отменить вызов',exact:true}).click();
        await page.getByRole('button',{name:'Бросить кубики'}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Дуэль',exact:true}).count(),0);
        await card('Кара').click();await dialog.waitFor();assert.equal(await duelButton.isDisabled(),true);
        await dialog.getByRole('button',{name:'Закрыть договор',exact:true}).click();
        await card('Алиса').click();assert.equal(await dialog.count(),0);
        game.turn=1;game.turnSerial++;game.revision++;await page.reload();
        await card('Кара').click();await dialog.waitFor();assert.equal(await duelButton.isDisabled(),true);
        await dialog.getByRole('button',{name:'Закрыть договор',exact:true}).click();
        game.turn=0;game.players[2].money=50;game.revision++;await page.reload();
        await card('Кара').click();await dialog.waitFor();assert.equal(await duelButton.isDisabled(),true);
        await dialog.getByRole('button',{name:'Закрыть договор',exact:true}).click();
        await card('Боб').click();await dialog.waitFor();
        await dialog.getByRole('spinbutton',{name:'Вы предлагаете деньги'}).fill('100');
        await dialog.getByRole('button',{name:'Предложить сделку',exact:true}).click();
        await dialog.waitFor({state:'hidden'});
        assert.equal(game.trade.to,'bob');assert.equal(game.trade.giveCash,100);
        assert.deepEqual(actions.filter(a=>a.action==='duelChallenge').map(a=>({to:a.to,bet:a.bet})),[{to:'cara',bet:700}]);
        assert.deepEqual(errors,[]);
      }catch(error){t.diagnostic(await page.locator('body').innerText());throw error}
      finally{await context.close();globalThis.monopolyRooms.delete(game.code)}
    }
  }finally{await browser.close()}
});
