// Run against a local Next server; NODE_PATH may point to an existing Playwright installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mock, test } from 'node:test';
import { GET, POST } from '../app/api/game/route.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const baseURL = process.env.BASE_URL || 'http://localhost:3000';

test('roulette: no icons, wheel enlarged by 10 percent from its reduced size, shared outcomes', async t => {
  const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
  const errors = [];
  const actions = [];
  const pages = [];
  let spinRandom = 0.8;
  let landingRandom = 0.05;
  let modeRandom = 0.5;
  let failNextSpin = false;
  let expecting503 = false;
  const game = {
    code:'ROULETTEUI',players:[
      {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:17},
      {id:'bob',name:'Боб',color:'#35aeeb',money:15000,position:0},
    ],host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,
    lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0,
  };
  globalThis.monopolyRooms.set(game.code,game);
  // Intercept only HTTP transport. Both clients call the real game API handlers;
  // randomness is controlled on the server side, never by a client-supplied result.
  async function player(id,viewport) {
    const context = await browser.newContext({viewport});
    await context.addInitScript(id=>localStorage.setItem('monopoly-player-id',id),id);
    await context.route('**/api/game*',async route=>{
      const request=route.request();
      let response;
      if(request.method()==='GET') response=await GET(new Request(request.url()));
      else {
        const body=request.postDataJSON();actions.push(body);
        if(body.action==='rouletteSpin'&&failNextSpin) {
          failNextSpin=false;
          await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Не удалось запустить рулетку. Попробуйте ещё раз.'})});
          return;
        }
        const values=body.action==='roll'?[0,0.2,modeRandom]:body.action==='rouletteSpin'?[spinRandom,landingRandom]:[];
        const random=mock.method(Math,'random',()=>values.shift()??0);
        try { response=await POST(new Request(request.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})); }
        finally { random.mock.restore(); }
      }
      await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
    });
    const page=await context.newPage();
    pages.push(page);page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error'&&!(expecting503&&message.text().includes('503'))) errors.push(message.text());});
    page.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')errors.push(`${request.failure()?.errorText}: ${request.url()}`);});
    await page.goto(`${baseURL}/?room=${game.code}`);
    return page;
  }
  async function checkBoard(page,selectedTitle) {
    const panel=page.getByRole('region',{name:'Рулетка',exact:true});
    await panel.waitFor();
    const square=await page.locator('.board-center').boundingBox();
    const bounds=await panel.boundingBox();
    assert.ok(bounds.x>=square.x&&bounds.y>=square.y&&bounds.x+bounds.width<=square.x+square.width+1&&bounds.y+bounds.height<=square.y+square.height+1,'Roulette must stay inside the central square');
    assert.equal(await page.getByRole('dialog',{name:'Колесо фортуны',exact:true}).count(),0);
    assert.equal(await page.locator('.board-center').getByRole('heading').count(),0,'No headings above the wheel');
    assert.equal(await panel.locator('header,h1,h2,h3,p,ul,ol').count(),0,'Only the wheel and button should be visible');
    assert.ok(!(await panel.innerText()).includes('%'),'Percentages must not be displayed');
    assert.equal(await panel.getByRole('button').count(),1,'Exactly one button below the wheel');
    const wheel=panel.getByRole('img',{name:'Колесо с 7 равными секторами',exact:true});
    assert.equal(await wheel.locator('[aria-hidden="true"],svg').count(),0,'Sectors must not contain decorative icons');
    assert.equal(await panel.getByText('MC',{exact:true}).count(),0,'No decorative monogram inside the wheel');
    for(const title of ['Пусто','Возврат ставки','Денежный приз','Дополнительный бросок','На старт','Джекпот','В тюрьму']) {
      await wheel.getByText(title,{exact:true}).waitFor();
    }
    const angles=await wheel.evaluate(element=>[...element.style.backgroundImage.matchAll(/(-?[\d.]+)deg/g)].map(match=>Number(match[1])));
    assert.equal(angles.length,14,'Seven sectors must each have a start and end angle');
    for(let i=0;i<angles.length;i+=2) assert.ok(Math.abs(angles[i+1]-angles[i]-360/7)<0.001,'All visual sectors must have the same angle');
    const wheelBounds=await wheel.locator('..').boundingBox();
    const button=await panel.getByRole('button').boundingBox();
    assert.ok(Math.abs(wheelBounds.width-button.width*0.88)<1,'The wheel diameter must increase by 10 percent from its previous 80 percent size');
    assert.ok(button.y>=wheelBounds.y+wheelBounds.height&&button.y+button.height<=square.y+square.height+1,'The button must fit below the wheel inside the square');
    if(selectedTitle) {
      const index=['Пусто','Возврат ставки','Денежный приз','Дополнительный бросок','На старт','Джекпот','В тюрьму'].indexOf(selectedTitle);
      const pointerAngle=await wheel.evaluate(element=>{
        const matrix=new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return ((-Math.atan2(matrix.b,matrix.a)*180/Math.PI)%360+360)%360;
      });
      const position=(pointerAngle-index*360/7)/(360/7);
      assert.ok(position>=0.1-0.001&&position<=0.9+0.001,'The pointer must stay safely inside the chosen sector');
      assert.ok(Math.abs(position-game.rouletteResult.stopPosition)<0.001,'Both clients must render the server-selected landing point');
    }
    return panel;
  }
  try {
    const alice=await player('alice',{width:1440,height:1000});
    const bob=await player('bob',{width:390,height:844});
    await alice.getByRole('button',{name:'Бросить кубики'}).click();
    await checkBoard(alice);
    await checkBoard(bob);
    await bob.keyboard.press('Escape');
    await checkBoard(bob);
    assert.equal(await bob.getByRole('button',{name:'Крутить за 1,000k',exact:true}).isDisabled(),true);
    const spin=alice.getByRole('button',{name:'Крутить за 1,000k',exact:true});
    failNextSpin=true;expecting503=true;
    await spin.click();
    await alice.locator('.toast').filter({hasText:'Не удалось запустить рулетку. Попробуйте ещё раз.'}).waitFor();
    expecting503=false;
    assert.equal(game.phase,'roulette');assert.equal(game.players[0].money,15000);
    await spin.click();
    await alice.getByRole('status').filter({hasText:'Дополнительный бросок'}).waitFor({state:'attached'});
    await bob.getByRole('status').filter({hasText:'Дополнительный бросок'}).waitFor({state:'attached'});
    const firstLanding=game.rouletteResult.stopPosition;
    assert.ok(Math.abs(firstLanding-0.14)<1e-9,'A spin must be able to stop away from the sector centre');
    await checkBoard(alice,'Дополнительный бросок');await checkBoard(bob,'Дополнительный бросок');
    assert.equal(game.players[0].money,15000);
    assert.match(await alice.locator('.player-entry').first().innerText(),/15,000k/);
    assert.equal(await alice.getByRole('button',{name:'Крутить за 1,000k',exact:true}).count(),0);
    assert.equal(await bob.getByRole('button',{name:'Продолжить',exact:true}).isDisabled(),true);
    assert.equal(actions.filter(action=>action.action==='rouletteSpin').length,2);
    assert.equal(await alice.locator('.toast').count(),0);
    const screenshot=process.env.ROULETTE_SCREENSHOT;
    if(screenshot) {
      await alice.screenshot({path:screenshot});
      await bob.screenshot({path:screenshot.replace(/\.png$/,'.spectator.png')});
    }
    await alice.getByRole('button',{name:'Продолжить',exact:true}).click();
    await alice.getByRole('button',{name:'Бросить кубики'}).waitFor();
    assert.notEqual(await alice.evaluate(()=>document.body.style.overflow),'hidden');
    assert.equal(game.turn,0);assert.equal(game.phase,'roll');
    assert.match(await alice.getByRole('log').innerText(),/рулетка.*Дополнительный бросок/);
    await bob.context().close();

    // Supplementary mobile, reload, movement, insufficient-cash and numbers-mode coverage.
    const reset = async (cash=15000) => {
      game.turn=0;game.phase='roulette';game.players[0].position=20;game.players[0].money=cash;
      game.players[0].jailed=false;game.players[0].doubles=0;
      game.extraTurn=undefined;game.bonusRolls=undefined;game.rouletteResult=undefined;
      game.jackpotResult=undefined;game.move=undefined;game.animationUntil=0;game.revision++;
      await alice.reload();
    };
    await alice.setViewportSize({width:390,height:844});
    for (const scenario of [
      {title:'Дополнительный бросок',random:0.8,landing:0.95,money:15000,position:20,extra:true},
      {title:'Джекпот',random:0.92,landing:0.65,money:19000,position:20},
      {title:'На старт',random:0.87,landing:0.15,money:17000,position:0,point:['7.1%','7.1%']},
      {title:'В тюрьму',random:0.95,landing:0.85,money:14000,position:10,point:['92.9%','7.1%']},
    ]) {
      await reset();spinRandom=scenario.random;landingRandom=scenario.landing;
      const before=actions.filter(action=>action.action==='rouletteSpin').length;
      const started=alice.waitForResponse(response=>response.request().method()==='POST'&&response.url().includes('/api/game')&&response.request().postDataJSON().action==='rouletteSpin');
      await alice.getByRole('button',{name:'Крутить за 1,000k',exact:true}).click();
      await started;
      const savedLanding=game.rouletteResult.stopPosition;
      if(scenario.title==='Джекпот') await alice.reload();
      await alice.getByRole('status').filter({hasText:scenario.title}).waitFor({state:'attached'});
      assert.equal(game.rouletteResult.stopPosition,savedLanding,'Reloading must keep the same landing point');
      if(scenario.extra) assert.ok(Math.abs(savedLanding-firstLanding)>0.6,'Repeated identical prizes must be able to land at different positions');
      assert.equal(game.players[0].money,scenario.money);
      assert.match(await alice.locator('.player-entry').first().innerText(),new RegExp(scenario.money.toLocaleString('en-US')+'k'));
      assert.equal(actions.filter(action=>action.action==='rouletteSpin').length,before+1);
      await checkBoard(alice,scenario.title);
      assert.ok(await alice.getByRole('button',{name:'Продолжить',exact:true}).evaluate(button=>{
        const rect=button.getBoundingClientRect();
        return rect.top>=0&&rect.bottom<=window.innerHeight;
      }),'Mobile continue button must fit inside the viewport without scrolling');
      if(screenshot&&scenario.title==='Джекпот') await alice.screenshot({path:screenshot.replace(/\.png$/,'.mobile.png')});
      await alice.getByRole('button',{name:'Продолжить',exact:true}).click();
      await alice.getByRole('region',{name:'Рулетка',exact:true}).waitFor({state:'detached'});
      assert.equal(game.turn,scenario.extra?0:1);assert.equal(game.players[0].position,scenario.position);
      if(scenario.point) await alice.waitForFunction(([left,top])=>{
        const token=document.querySelector('.token[title="Алиса"]');
        return token?.style.left.includes(left)&&token?.style.top.includes(top);
      },scenario.point);
      assert.equal(!!game.players[0].jailed,scenario.title==='В тюрьму');
      assert.equal(game.players[0].money,scenario.money);
    }
    await reset(999);
    for(const viewport of [{width:320,height:568},{width:844,height:390},{width:390,height:844}]) {
      await alice.setViewportSize(viewport);
      await checkBoard(alice);
      await alice.getByRole('button',{name:'Пропустить',exact:true}).scrollIntoViewIfNeeded();
      assert.ok(await alice.getByRole('button',{name:'Пропустить',exact:true}).evaluate(button=>{
        const rect=button.getBoundingClientRect();
        return rect.top>=0&&rect.bottom<=window.innerHeight;
      }),'Skip must stay visible on small and landscape screens');
    }
    assert.equal(await alice.getByRole('button',{name:'Крутить за 1,000k',exact:true}).count(),0);
    await alice.getByRole('button',{name:'Пропустить',exact:true}).click();
    await alice.getByRole('region',{name:'Рулетка',exact:true}).waitFor({state:'detached'});
    assert.equal(game.players[0].money,999);assert.equal(game.turn,1);

    await reset();game.phase='roll';game.players[0].position=17;game.revision++;modeRandom=0;
    await alice.reload();
    await alice.getByRole('button',{name:'Бросить кубики'}).click();
    await alice.getByRole('button',{name:'Играть',exact:true}).click();
    await alice.getByRole('status').filter({hasText:'ВЫИГРЫШ'}).waitFor();
    assert.equal(game.players[0].money,19000);
    await alice.getByRole('button',{name:/^Продолжить/}).click();
    await alice.getByRole('status').filter({hasText:'ВЫИГРЫШ'}).waitFor({state:'detached'});
    assert.equal(game.turn,1);
    assert.deepEqual(errors,[]);
  } catch(error) {
    for(const page of pages) if(!page.isClosed()) t.diagnostic(await page.locator('body').innerText());
    t.diagnostic(JSON.stringify({errors,actions}));
    throw error;
  } finally {
    await browser.close();globalThis.monopolyRooms.delete(game.code);
  }
});
