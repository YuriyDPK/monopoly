import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { GET, POST } from '../app/api/game/route.ts';

const {chromium}=createRequire(import.meta.url)('playwright');
const baseURL=process.env.BASE_URL||'http://localhost:3000';

test('traps: cell setup, four amounts, private reserve, reload, cooldown and shared landing/payment on desktop and mobile',async t=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const game={code:'TRAPUI',players:[
    {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0},
    {id:'bob',name:'Боб',color:'#35aeeb',money:15000,position:0},
    {id:'cara',name:'Кара',color:'#95ca50',money:15000,position:0},
  ],host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0};
  globalThis.monopolyRooms.set(game.code,game);
  const pages=[],errors=[],actions=[];
  async function player(id,viewport){
    const context=await browser.newContext({viewport});
    await context.addInitScript(id=>localStorage.setItem('monopoly-player-id',id),id);
    await context.route('**/api/game*',async route=>{
      const request=route.request();let response;
      if(request.method()==='GET')response=await GET(new Request(request.url(),{headers:request.headers()}));
      else{
        const body=request.postDataJSON();actions.push({action:body.action,id:body.id,tile:body.tile,amount:body.amount});
        const values=body.action==='roll'?[0,0.17]:[];
        const random=mock.method(Math,'random',()=>values.shift()??0);
        try{response=await POST(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()}))}
        finally{random.mock.restore()}
      }
      await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    const page=await context.newPage();pages.push(page);page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.goto(`${baseURL}/?room=${game.code}`);return page;
  }
  const card=(page,name)=>page.locator('.player-card').filter({hasText:name});
  try{
    const alice=await player('alice',{width:1440,height:1000});
    const bob=await player('bob',{width:390,height:844});
    const cara=await player('cara',{width:1280,height:900});
    await alice.setViewportSize({width:390,height:844});
    await alice.getByRole('button',{name:'Balenciaga, свободная компания',exact:true}).click();
    const property=alice.getByRole('region',{name:'Компания Balenciaga',exact:true});await property.waitFor();
    await property.getByRole('button',{name:'Поставить ловушку',exact:true}).click();
    const setup=property.getByRole('region',{name:'Установка ловушки',exact:true});await setup.waitFor();
    await t.test('trap setup advertises ten full rounds',async()=>{
      assert.match(await setup.innerText(),/Работает 10 полных кругов/);
    });
    assert.equal(await setup.getByRole('radio').count(),4);
    for(const amount of ['500k','1,000k','2,000k','5,000k'])assert.equal(await setup.getByRole('radio',{name:amount,exact:true}).count(),1);
    await setup.getByRole('radio',{name:'5,000k',exact:true}).check();
    assert.equal(await setup.getByRole('button',{name:'Установить за 2,000k',exact:true}).isEnabled(),true);
    await setup.getByRole('radio',{name:'1,000k',exact:true}).check();
    if(process.env.TRAP_SCREENSHOT)await alice.screenshot({path:process.env.TRAP_SCREENSHOT.replace(/\.png$/,'.setup.mobile.png')});
    await setup.getByRole('button',{name:'Установить за 400k',exact:true}).click();
    await property.waitFor({state:'hidden'});
    await alice.setViewportSize({width:1440,height:1000});
    await alice.getByRole('region',{name:'Ваши ловушки',exact:true}).getByText('Balenciaga',{exact:false}).waitFor();
    await alice.getByRole('img',{name:/^Ваша ловушка:/}).waitFor();
    assert.match(await card(alice,'Алиса').innerText(),/14,600k/);
    for(const page of [bob,cara]){
      await page.getByText('Алиса устанавливает ловушку',{exact:true}).waitFor();
      assert.match(await card(page,'Алиса').innerText(),/15,000k/);
      assert.equal(await page.getByRole('img',{name:/^Ваша ловушка:/}).count(),0);
      assert.equal(await page.getByRole('region',{name:'Ваши ловушки',exact:true}).getByText('Balenciaga',{exact:false}).count(),0);
      const publicView=await page.evaluate(async()=>{
        const room=new URLSearchParams(location.search).get('room');
        return (await fetch(`/api/game?room=${room}&id=alice`,{headers:{'X-Player-Key':localStorage.getItem('monopoly-private-key')||''}})).json();
      });
      assert.equal(publicView.myTrap,undefined);assert.equal(publicView.traps,undefined);assert.equal(publicView.players[0].money,15000);
    }
    await alice.reload();await alice.getByRole('region',{name:'Ваши ловушки',exact:true}).getByText('Balenciaga',{exact:false}).waitFor();
    assert.equal(game.players[0].money,14600);
    await alice.getByRole('button',{name:'Adidas, свободная компания',exact:true}).click();
    assert.equal(await alice.getByRole('region',{name:'Компания Adidas',exact:true}).getByRole('button',{name:'Поставить ловушку',exact:true}).isDisabled(),true);
    await alice.getByRole('button',{name:'Закрыть информацию о компании',exact:true}).click();
    game.turn=1;game.revision++;
    await bob.getByRole('button',{name:'Бросить кубики'}).click();
    for(const page of [alice,bob,cara]){
      const revealed=page.getByRole('region',{name:'Ловушка',exact:true});await revealed.waitFor();
      assert.match(await revealed.innerText(),/Боб/);assert.match(await revealed.innerText(),/Алиса/);assert.match(await revealed.innerText(),/Balenciaga/);assert.match(await revealed.innerText(),/1,000k/);
      const bounds=await revealed.boundingBox(),square=await page.locator('.board-center').boundingBox();
      assert.ok(bounds.x>=square.x&&bounds.y>=square.y&&bounds.x+bounds.width<=square.x+square.width+1&&bounds.y+bounds.height<=square.y+square.height+1);
    }
    assert.equal(await alice.getByRole('button',{name:'Оплатить 1,000k',exact:true}).count(),0);
    assert.equal(await cara.getByRole('button',{name:'Оплатить 1,000k',exact:true}).count(),0);
    assert.equal(await alice.getByRole('img',{name:/^Ваша ловушка:/}).count(),0);
    if(process.env.TRAP_SCREENSHOT){await alice.screenshot({path:process.env.TRAP_SCREENSHOT});await bob.screenshot({path:process.env.TRAP_SCREENSHOT.replace(/\.png$/,'.mobile.png')})}
    await bob.getByRole('button',{name:'Оплатить 1,000k',exact:true}).click();
    await bob.getByRole('button',{name:'Купить',exact:true}).waitFor();
    assert.equal(game.phase,'buy');assert.equal(game.turn,1);assert.deepEqual(game.players.map(p=>p.money),[15600,14000,15000]);assert.equal(game.traps.length,0);
    await bob.getByRole('button',{name:'Купить',exact:true}).click();
    assert.equal(game.owners[3],'bob');assert.equal(actions.filter(a=>a.action==='trapPlace').length,1);assert.deepEqual(errors,[]);
  }catch(error){for(const page of pages)if(!page.isClosed())t.diagnostic(await page.locator('body').innerText());t.diagnostic(JSON.stringify({errors,actions}));throw error}
  finally{await browser.close();globalThis.monopolyRooms.delete(game.code)}
});

test('traps: an existing trap marks its cell only for the owner, survives reload and disappears on expiry',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const ownerKey='trap-marker-owner-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const game={code:'TRAPMARK',players:[
    {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0},
    {id:'bob',name:'Боб',color:'#35aeeb',money:15000,position:0},
    {id:'cara',name:'Кара',color:'#95ca50',money:15000,position:0},
  ],host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,mortgaged:[],dice:[],log:[],revision:0};
  globalThis.monopolyRooms.set(game.code,game);
  const errors=[];
  async function post(action,id='alice',extra={}){
    const response=await POST(new Request(`${baseURL}/api/game`,{method:'POST',headers:{'Content-Type':'application/json','X-Player-Key':id==='alice'?ownerKey:''},body:JSON.stringify({room:game.code,id,action,...extra})}));
    assert.equal(response.status,200);return response;
  }
  async function player(id,viewport){
    const context=await browser.newContext({viewport});
    await context.addInitScript(({id,key})=>{localStorage.setItem('monopoly-player-id',id);if(key)localStorage.setItem('monopoly-private-key',key)},{id,key:id==='alice'?ownerKey:''});
    await context.route('**/api/game*',async route=>{
      const request=route.request();
      const response=await (request.method()==='GET'?GET(new Request(request.url(),{headers:request.headers()})):POST(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()})));
      await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${baseURL}/?room=${game.code}`);return page;
  }
  const marker=(page,name='Balenciaga',rounds=10)=>page.getByRole('img',{name:`Ваша ловушка: ${name}, штраф 1,000k, полных кругов осталось: ${rounds}`,exact:true});
  try{
    await post('trapPlace','alice',{tile:3,amount:1000});
    const alice=await player('alice',{width:1440,height:1000}),bob=await player('bob',{width:1280,height:900}),cara=await player('cara',{width:390,height:844});
    await marker(alice).waitFor();
    for(const width of [1440,390]){
      await alice.setViewportSize({width,height:width===1440?1000:844});
      for(const [tile,name] of [[3,'Balenciaga'],[11,'X'],[23,'Lufthansa'],[37,'Anthropic']]){
        game.traps[0].tile=tile;game.revision++;
        const mark=marker(alice,name);await mark.waitFor();assert.equal(await mark.isVisible(),true);
        assert.match(await mark.innerText(),/1,000k/);assert.match(await mark.innerText(),/10/);
        const bounds=await mark.boundingBox(),cell=await alice.getByRole('button',{name:`${name}, свободная компания`,exact:true}).boundingBox();
        assert.ok(bounds.x+bounds.width/2>=cell.x&&bounds.x+bounds.width/2<=cell.x+cell.width&&bounds.y+bounds.height/2>=cell.y&&bounds.y+bounds.height/2<=cell.y+cell.height);
        assert.ok(bounds.width<=cell.width+1&&bounds.height<=cell.height+1);
        if(tile===3&&process.env.TRAP_MARKER_SCREENSHOT)await alice.screenshot({path:process.env.TRAP_MARKER_SCREENSHOT.replace(/\.png$/,`.${width}.png`)});
        await alice.getByRole('button',{name:`${name}, свободная компания`,exact:true}).click();
        await alice.getByRole('region',{name:`Компания ${name}`,exact:true}).waitFor();
        await alice.getByRole('button',{name:'Закрыть информацию о компании',exact:true}).click();
      }
    }
    for(const page of [bob,cara])assert.equal(await page.getByRole('img',{name:/^Ваша ловушка:/}).count(),0);
    game.traps[0].tile=3;game.revision++;await alice.reload();await marker(alice).waitFor();
    for(let round=0;round<10;round++){
      for(let turn=0;turn<3;turn++){
        game.phase='pay';game.debt={amount:1,reason:'Тест полного круга'};game.animationUntil=0;await post('pay',game.players[game.turn].id);
      }
      if(round<9)await marker(alice,'Balenciaga',9-round).waitFor();
    }
    await marker(alice,'Balenciaga',1).waitFor({state:'hidden'});
    assert.equal(await alice.getByRole('img',{name:/^Ваша ловушка:/}).count(),0);assert.equal(game.traps.length,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();globalThis.monopolyRooms.delete(game.code)}
});

test('traps: a debtor can borrow, mortgage and pay, or declare bankruptcy without blocking the room',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const games=[];
  async function prepare(code,assets){
    const game={code,players:[
      {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0},
      {id:'bob',name:'Боб',color:'#35aeeb',money:100,position:0,loanUsed:!assets},
      {id:'cara',name:'Кара',color:'#95ca50',money:15000,position:0},
    ],host:'alice',started:true,turn:0,phase:'roll',owners:assets?{39:'bob'}:{},levels:{},turnSerial:1,mortgaged:[],dice:[],log:[],revision:0};
    globalThis.monopolyRooms.set(code,game);games.push(game);
    const placed=await POST(new Request(`${baseURL}/api/game`,{method:'POST',headers:{'Content-Type':'application/json','X-Player-Key':'alice-private-test-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'},body:JSON.stringify({room:code,id:'alice',action:'trapPlace',tile:3,amount:5000})}));
    assert.equal(placed.status,200);game.turn=1;
    const values=[0,0.17],random=mock.method(Math,'random',()=>values.shift()??0);
    try{await POST(new Request(`${baseURL}/api/game`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:code,id:'bob',action:'roll'})}))}
    finally{random.mock.restore()}
    game.animationUntil=0;return game;
  }
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>localStorage.setItem('monopoly-player-id','bob'));
    await context.route('**/api/game*',async route=>{
      const request=route.request();
      const response=await (request.method()==='GET'?GET(new Request(request.url(),{headers:request.headers()})):POST(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()})));
      await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const funded=await prepare('TRAPFUND',true);await page.goto(`${baseURL}/?room=${funded.code}`);
    const revealed=page.getByRole('region',{name:'Ловушка',exact:true}),pay=revealed.getByRole('button',{name:'Оплатить 5,000k',exact:true});
    await revealed.waitFor();assert.equal(await pay.isDisabled(),true);
    await page.getByRole('button',{name:'OpenAI, владелец Боб',exact:true}).click();
    await page.getByRole('region',{name:'Компания OpenAI',exact:true}).getByRole('button',{name:'Заложить · +2,000k',exact:true}).click();
    await page.getByRole('button',{name:'Закрыть информацию о компании',exact:true}).click();
    assert.equal(funded.players[1].money,2100);
    await revealed.getByRole('button',{name:'Взять кредит',exact:true}).click();
    await revealed.getByRole('button',{name:'Взять кредит',exact:true}).waitFor({state:'hidden'});assert.equal(funded.players[1].money,7100);
    await pay.click();await page.getByRole('button',{name:'Купить',exact:true}).waitFor();
    assert.equal(funded.players[1].money,2100);assert.equal(funded.players[0].money,18000);assert.equal(funded.phase,'buy');
    const insolvent=await prepare('TRAPDEAD',false);await page.goto(`${baseURL}/?room=${insolvent.code}`);await revealed.waitFor();
    await revealed.getByRole('button',{name:'Объявить банкротство',exact:true}).click();
    await revealed.waitFor({state:'hidden'});assert.equal(insolvent.players[1].bankrupt,true);assert.equal(insolvent.turn,2);assert.equal(insolvent.phase,'roll');assert.equal(insolvent.trapResult,undefined);
  }finally{await browser.close();for(const game of games)globalThis.monopolyRooms.delete(game.code)}
});
