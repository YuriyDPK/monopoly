import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/api/game/route';
import { CHANCE_CARDS, drawChance } from '../lib/chance';
import { DIAMOND_FEE, LOAN_PRINCIPAL, LOAN_TOTAL_DUE, LOAN_TURNS, PROPERTY_RENTS, effectivePropertyLevel, propertyRent, propertyUpgradeCost, playerCapital, liquidFunds, tiles, type Game } from '../lib/game';

let fixtureNumber = 0;
function fixture(): Game {
  const game: Game = {
    code: `TEST${++fixtureNumber}`,
    players: [
      {id:'alice',name:'Алиса',color:'#fff',money:15000,position:0},
      {id:'bob',name:'Боб',color:'#000',money:15000,position:0},
    ],
    host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,
    lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0,
  };
  (globalThis as typeof globalThis & {monopolyRooms:Map<string,Game>}).monopolyRooms.set(game.code,game);
  return game;
}

async function act(game: Game, action: string, extra: Record<string,unknown> = {}, id = game.players[game.turn].id) {
  const response = await POST(new Request('http://localhost/api/game', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,room:game.code,id,...extra}),
  }));
  return {status:response.status,body:await response.json()};
}

test('individual properties charge little; a street triples base rent and upgrades rise sharply', () => {
  assert.equal(Object.keys(PROPERTY_RENTS).length,22);
  assert.equal(propertyRent(1,0),20);
  assert.equal(propertyRent(3,0),40);
  assert.equal(propertyRent(39,0),500);
  for (const [index,rents] of Object.entries(PROPERTY_RENTS)) {
    assert.equal(rents.length,7);
    assert.equal(rents[1],rents[0]*3);
    assert.ok(rents.every((rent,level)=>level===0||rent>rents[level-1]));
    assert.equal(propertyRent(Number(index),6),rents[6]);
  }
  assert.equal(effectivePropertyLevel({1:'alice'}, {}, 1),0);
  assert.equal(effectivePropertyLevel({1:'alice',3:'alice'}, {}, 1),1);
  assert.equal(effectivePropertyLevel({1:'alice',3:'alice'}, {1:2}, 1),3);
  assert.equal(propertyUpgradeCost(1,0),500);
  assert.equal(propertyUpgradeCost(1,4),500);
  assert.equal(propertyUpgradeCost(11,0),1000);
  assert.equal(propertyUpgradeCost(21,0),1500);
  assert.equal(propertyUpgradeCost(39,0),2000);
});

test('rent uses the landed property tariff and a payment cannot be applied twice', async t => {
  let now=10000;
  t.mock.method(Date,'now',()=>now);
  const dice=[0,0.2];
  t.mock.method(Math,'random',()=>dice.shift()??0);
  const game=fixture();
  game.owners={1:'bob',3:'bob'};
  assert.equal((await act(game,'roll')).status,200);
  assert.equal(game.players[0].position,3);
  assert.equal(game.debt?.amount,120);
  assert.equal(game.players[0].money,15000);
  assert.equal((await act(game,'pay')).status,400);
  now+=10000;
  assert.equal((await act(game,'pay')).status,200);
  assert.equal(game.players[0].money,14880);
  assert.equal(game.players[1].money,15120);
  assert.equal((await act(game,'pay',{},'alice')).status,400);
});

test('diamond requires confirmation, charges exactly 1000 and permits financing insufficient cash', async t => {
  let now=10000;
  t.mock.method(Date,'now',()=>now);
  const dice=[0,0.2];
  t.mock.method(Math,'random',()=>dice.shift()??0);
  const game=fixture();
  game.players[0].position=33;
  game.players[0].money=100;
  await act(game,'roll');
  assert.equal(game.players[0].position,36);
  assert.equal(game.phase,'pay');
  assert.equal(game.debt?.kind,'diamond');
  assert.equal(game.debt?.amount,DIAMOND_FEE);
  assert.equal(game.players[0].money,100);
  assert.equal((await act(game,'loanTake')).status,400);
  now+=10000;
  assert.equal((await act(game,'pay')).status,400);
  assert.equal((await act(game,'loanTake')).status,200);
  assert.equal(game.debt?.amount,1000);
  assert.equal((await act(game,'pay')).status,200);
  assert.equal(game.players[0].money,100+LOAN_PRINCIPAL-1000);
  assert.equal(game.players[0].loan?.turnsLeft,LOAN_TURNS-1);
  assert.equal((await act(game,'pay',{},'alice')).status,400);
});

test('positive chance card is applied once, after confirmation and movement', async t => {
  let now=10000;
  t.mock.method(Date,'now',()=>now);
  const values=[0.34,0.51,0]; // 3 + 4, then dividend.
  t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();
  await act(game,'roll');
  assert.equal(game.players[0].position,7);
  assert.equal(game.phase,'chanceResult');
  assert.equal(game.chanceResult?.id,'dividend');
  assert.equal(game.chanceResult?.amount,500);
  assert.equal(game.players[0].money,15000);
  assert.equal((await act(game,'chanceContinue')).status,400);
  now+=10000;
  assert.equal((await act(game,'chanceContinue',{},'bob')).status,400);
  assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.players[0].money,15500);
  assert.equal(game.chanceResult,undefined);
  assert.equal((await act(game,'chanceContinue',{},'alice')).status,400);
});

test('negative chance cards create payable debt instead of making a balance negative', async t => {
  let now=10000;
  t.mock.method(Date,'now',()=>now);
  const values=[0.34,0.51,0.6]; // Insurance: -400.
  t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();
  game.players[0].money=100;
  await act(game,'roll');
  assert.equal(game.chanceResult?.amount,-400);
  now+=10000;
  await act(game,'chanceContinue');
  assert.equal(game.phase,'pay');
  assert.equal(game.debt?.kind,'chance');
  assert.equal(game.debt?.amount,400);
  assert.equal(game.players[0].money,100);
  assert.equal((await act(game,'pay')).status,400);
  assert.equal(game.players[0].money,100);
});

test('a chance reward from a room created before the update can be acknowledged without a second payout', async () => {
  const game=fixture();
  game.phase='chanceResult';
  game.players[0].money=15500;
  assert.equal((await act(game,'chanceContinue',{},'bob')).status,400);
  assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.players[0].money,15500);
  assert.equal(game.turn,1);
  assert.equal(game.phase,'roll');
});

test('chance has 13 distinct events, no immediate repeat, and portfolio-based amounts', t => {
  const game=fixture(),player=game.players[0];
  assert.equal(CHANCE_CARDS.length,13);
  assert.equal(new Set(CHANCE_CARDS.map(card=>card.id)).size,13);
  const random=t.mock.method(Math,'random',()=>0);
  const first=drawChance(game,player);
  game.lastChanceId=first.id;
  assert.notEqual(drawChance(game,player).id,first.id);
  game.lastChanceId=undefined;
  game.owners={1:'alice',3:'alice',39:'bob'};
  game.levels={1:2,3:5,39:5};
  random.mock.mockImplementation(()=>10.1/13);
  assert.equal(drawChance(game,player).amount,-1300);
  random.mock.mockImplementation(()=>5.1/13);
  assert.equal(drawChance(game,player).amount,400);
});

test('a loan is available once per game, only on the borrower turn after movement', async () => {
  const game=fixture();
  game.started=false;
  assert.equal((await act(game,'loanTake')).status,400);
  game.started=true;
  assert.equal((await act(game,'loanTake',{},'bob')).status,400);
  game.phase='auction';
  assert.equal((await act(game,'loanTake')).status,400);
  game.phase='finished';
  assert.equal((await act(game,'loanTake')).status,400);
  game.phase='roll';game.players[0].bankrupt=true;
  assert.equal((await act(game,'loanTake')).status,400);
  game.players[0].bankrupt=false;
  game.animationUntil=Date.now()+10000;
  assert.equal((await act(game,'loanTake')).status,400);
  game.animationUntil=0;
  assert.equal((await act(game,'loanTake')).status,200);
  assert.equal(game.players[0].money,15000+LOAN_PRINCIPAL);
  assert.deepEqual(game.players[0].loan,{principal:LOAN_PRINCIPAL,totalDue:LOAN_TOTAL_DUE,turnsLeft:LOAN_TURNS});
  assert.equal((await act(game,'loanTake')).status,400);
  assert.equal((await act(game,'loanRepay')).status,200);
  assert.equal(game.players[0].money,15000+LOAN_PRINCIPAL-LOAN_TOTAL_DUE);
  assert.equal(game.players[0].loan,undefined);
  assert.equal(game.players[0].loanUsed,true);
  assert.equal((await act(game,'loanTake')).status,400);
});

test('fifteen completed own turns mature a loan, opponent turns do not, payment preserves the turn', async () => {
  const game=fixture();
  await act(game,'loanTake');
  for (let turn=0;turn<LOAN_TURNS;turn++) {
    game.phase='pay';game.debt={amount:1,reason:'Test payment'};
    await act(game,'pay');
    assert.equal(game.players[0].loan?.turnsLeft,LOAN_TURNS-turn-1);
    assert.equal(game.turn,1);
    game.phase='pay';game.debt={amount:1,reason:'Test payment'};
    await act(game,'pay');
    assert.equal(game.turn,0);
    assert.equal(game.players[0].loan?.turnsLeft,LOAN_TURNS-turn-1);
  }
  assert.equal(game.phase,'pay');
  assert.equal(game.debt?.kind,'loan');
  assert.equal(game.debt?.amount,LOAN_TOTAL_DUE);
  assert.equal((await act(game,'roll')).status,400);
  const serial=game.turnSerial;
  await act(game,'pay');
  assert.equal(game.turn,0);
  assert.equal(game.turnSerial,serial);
  assert.equal(game.phase,'roll');
  assert.equal(game.players[0].loan,undefined);
  assert.equal(game.players[0].money,15000+LOAN_PRINCIPAL-LOAN_TOTAL_DUE-LOAN_TURNS);
});

test('loan maturity preserves jail status and extra turns', async () => {
  const game=fixture();
  game.players[0].jailed=true;
  game.players[0].jailAttempts=2;
  game.players[0].loan={principal:3000,totalDue:3300,turnsLeft:0};
  game.players[0].loanUsed=true;
  game.turn=1;game.phase='pay';game.debt={amount:1,reason:'Test'};
  await act(game,'pay');
  assert.equal(game.debt?.kind,'loan');
  await act(game,'pay');
  assert.equal(game.phase,'jail');
  assert.equal(game.players[0].jailed,true);
  assert.equal(game.players[0].jailAttempts,2);

  const extra=fixture();
  extra.players[0].loan={principal:3000,totalDue:3300,turnsLeft:1};
  extra.players[0].loanUsed=true;
  extra.players[0].doubles=1;
  extra.extraTurn='alice';extra.phase='pay';extra.debt={amount:1,reason:'Test'};
  await act(extra,'pay');
  assert.equal(extra.turn,0);
  assert.equal(extra.debt?.kind,'loan');
  await act(extra,'pay');
  assert.equal(extra.phase,'roll');
  assert.equal(extra.turn,0);
  assert.equal(extra.players[0].doubles,1);
});

test('loan cannot be repaid ahead of a mandatory payment or with insufficient funds', async () => {
  const game=fixture();
  await act(game,'loanTake');
  game.phase='pay';game.debt={amount:1000,reason:'Diamond',kind:'diamond'};
  assert.equal((await act(game,'loanRepay')).status,400);
  assert.equal(game.debt.amount,1000);
  game.phase='roll';game.debt=undefined;game.players[0].money=100;
  assert.equal((await act(game,'loanRepay')).status,400);
  assert.equal(game.players[0].loan?.totalDue,LOAN_TOTAL_DUE);
});

test('default on a mature loan clears the loan and releases mortgaged assets to the bank', async () => {
  const game=fixture();
  game.players[0].money=10;
  game.players[0].loan={principal:3000,totalDue:3300,turnsLeft:0};
  game.players[0].loanUsed=true;
  game.owners={1:'alice'};game.mortgaged=[1];game.mortgageTurns={1:10};
  game.phase='pay';game.debt={amount:3300,reason:'Погашение кредита',kind:'loan',afterPayment:'resumeTurn'};
  assert.equal((await act(game,'bankrupt')).status,200);
  assert.equal(game.players[0].bankrupt,true);
  assert.equal(game.players[0].loan,undefined);
  assert.equal(game.owners[1],undefined);
  assert.equal(game.mortgaged.length,0);
  assert.equal(game.phase,'finished');
  assert.equal(game.winner,'bob');
});

test('bots confirm chance and diamond debts, take a rescue loan, and pay without stalling', async t => {
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{
    callbacks.push(callback);
    return {} as ReturnType<typeof setTimeout>;
  });
  for (const scenario of ['chance','diamond']) {
    const game=fixture();
    game.players[0].bot=true;
    game.players[0].money=100;
    if(scenario==='chance'){
      game.phase='chanceResult';
      game.chanceResult={id:'test',title:'Расход',description:'Тестовый расход',amount:-1000,playerId:'alice'};
    }else{
      game.phase='pay';
      game.debt={amount:1000,reason:'Бриллиант',kind:'diamond'};
    }
    await act(game,'chat',{message:'Продолжаем'},'bob');
    if(scenario==='chance'){
      assert.equal(callbacks.length,1);
      await callbacks.shift()!();
      assert.equal(game.phase,'pay');
      assert.equal(game.debt?.kind,'chance');
    }
    assert.equal(callbacks.length,1);
    await callbacks.shift()!();
    assert.equal(game.players[0].money,100+LOAN_PRINCIPAL);
    assert.equal(game.players[0].loanUsed,true);
    assert.equal(game.debt?.amount,1000);
    assert.equal(callbacks.length,1);
    await callbacks.shift()!();
    assert.equal(game.players[0].money,100+LOAN_PRINCIPAL-1000);
    assert.equal(game.players[0].loan?.turnsLeft,LOAN_TURNS-1);
    assert.equal(game.turn,1);
    assert.equal(game.phase,'roll');
    assert.equal(callbacks.length,0);
  }
});

test('bots repay mature loans before rolling and default when no rescue is available', async t => {
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{
    callbacks.push(callback);
    return {} as ReturnType<typeof setTimeout>;
  });
  const solvent=fixture();
  solvent.players[0].bot=true;solvent.players[0].money=3300;
  solvent.players[0].loanUsed=true;solvent.players[0].loan={principal:3000,totalDue:3300,turnsLeft:0};
  solvent.phase='pay';solvent.debt={amount:3300,reason:'Погашение кредита',kind:'loan',afterPayment:'resumeTurn'};
  await act(solvent,'chat',{message:'Продолжаем'},'bob');
  await callbacks.shift()!();
  assert.equal(solvent.players[0].money,0);
  assert.equal(solvent.players[0].loan,undefined);
  assert.equal(solvent.phase,'roll');
  assert.equal(solvent.turn,0);
  assert.equal(callbacks.length,1);
  // The next queued action is the bot's roll. End this isolated fixture here.
  solvent.phase='finished';
  await callbacks.shift()!();

  const insolvent=fixture();
  insolvent.players[0].bot=true;insolvent.players[0].money=100;
  insolvent.players[0].loanUsed=true;insolvent.players[0].loan={principal:3000,totalDue:3300,turnsLeft:0};
  insolvent.phase='pay';insolvent.debt={amount:3300,reason:'Погашение кредита',kind:'loan',afterPayment:'resumeTurn'};
  await act(insolvent,'chat',{message:'Продолжаем'},'bob');
  await callbacks.shift()!();
  assert.equal(insolvent.players[0].bankrupt,true);
  assert.equal(insolvent.players[0].loan,undefined);
  assert.equal(insolvent.phase,'finished');
  assert.equal(insolvent.winner,'bob');
  assert.equal(callbacks.length,0);
});


test('capital and liquidation value account for improvements, mortgages and loans', () => {
  const game=fixture(), player=game.players[0];
  player.money=100;player.loan={principal:5000,totalDue:5500,turnsLeft:10};
  game.owners={1:'alice',3:'alice',39:'bob'};game.levels={1:2};game.mortgaged=[3];
  assert.equal(playerCapital(game,player),100+600+1000+300-5500);
  assert.equal(liquidFunds(game,player),100+300+500);
});

test('bankruptcy is allowed before liquidating assets only when they cannot cover the debt', async () => {
  const game=fixture();game.players[0].money=100;game.owners={1:'alice'};game.levels={1:2};
  game.owners[3]='alice';game.mortgaged=[3];game.mortgageTurns={3:4};
  game.owners[39]='bob';
  game.phase='pay';game.debt={amount:900,reason:'Аренда',to:'bob'};
  assert.equal(liquidFunds(game,game.players[0]),900);
  assert.equal((await act(game,'bankrupt')).status,400);
  game.debt.amount=901;
  assert.equal((await act(game,'bankrupt')).status,200);
  assert.equal(game.players[0].bankrupt,true);
  assert.equal(game.players[1].money,15100);
  assert.equal(game.owners[1],undefined);
  assert.equal(game.owners[3],undefined);
  assert.equal(game.owners[39],'bob');
  assert.equal(game.levels?.[1],undefined);
  assert.deepEqual(game.mortgaged,[]);
  assert.equal(game.mortgageTurns?.[3],undefined);
  assert.equal(game.winner,'bob');
});

test('a payable chance expense is confirmed and paid once', async () => {
  const game=fixture();game.phase='chanceResult';
  game.chanceResult={id:'test',title:'Расход',description:'Тест',amount:-400,playerId:'alice'};
  assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.players[0].money,14600);
  assert.equal(game.turn,1);
  assert.equal(game.phase,'roll');
  assert.equal((await act(game,'chanceContinue',{},'alice')).status,400);
});

test('surrender outside a turn cancels trades and auction bids while the game continues', async () => {
  const game=fixture();game.players.push({id:'carol',name:'Кэрол',color:'#aaa',money:1000,position:0});
  game.owners={1:'bob'};game.trade={from:'alice',to:'bob',give:[],take:[1],giveCash:0,takeCash:0};
  game.phase='auction';game.auction={tile:3,bid:600,bidder:'bob',passed:['alice'],seller:'alice'};
  assert.equal((await act(game,'surrender',{},'bob')).status,200);
  assert.equal(game.players[1].bankrupt,true);assert.equal(game.owners[1],undefined);
  assert.equal(game.trade,undefined);assert.equal(game.auction?.bid,0);assert.equal(game.auction?.bidder,undefined);
  assert.equal(game.turn,0);assert.equal(game.phase,'auction');
  assert.equal((await act(game,'surrender',{},'bob')).status,400);
});

test('surrender on the current turn releases businesses and gives cash to the creditor', async () => {
  const game=fixture();game.players.push({id:'carol',name:'Кэрол',color:'#aaa',money:1000,position:0});
  game.players[0].money=100;game.owners={1:'alice'};game.phase='pay';game.debt={amount:500,reason:'Аренда',to:'bob'};
  assert.equal((await act(game,'surrender')).status,200);
  assert.equal(game.owners[1],undefined);assert.equal(game.players[1].money,15100);
  assert.equal(game.turn,1);assert.equal(game.phase,'roll');
});


test('a player may improve a business only during their own turn', async () => {
  const game=fixture();
  game.owners={1:'alice',3:'alice'};
  game.turn=1;
  assert.equal((await act(game,'upgrade',{tile:1},'alice')).status,400);
  assert.equal(game.players[0].money,15000);
  assert.equal(game.levels?.[1],undefined);
  game.turn=0;
  assert.equal((await act(game,'upgrade',{tile:1},'alice')).status,200);
  assert.equal(game.players[0].money,14500);
  assert.equal(game.levels?.[1],1);
  assert.equal((await act(game,'upgrade',{tile:3},'alice')).status,400);
});


test('chance moves to the next unowned company, crossing start and offering purchase once', async t => {
  let now=10000;t.mock.method(Date,'now',()=>now);
  const game=fixture();game.players[0].position=38;game.players[0].money=5000;game.owners={39:'bob'};
  game.phase='chanceResult';game.chanceResult={id:'nearest-company',title:'Новые возможности',description:'Вперёд',amount:0,playerId:'alice',movement:'nearestAvailableCompany'};
  assert.equal((await act(game,'chanceContinue',{},'bob')).status,400);
  assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.players[0].position,1);assert.equal(game.players[0].money,7000);
  assert.equal(game.phase,'buy');assert.deepEqual(game.move,{playerId:'alice',steps:3,noDice:true});
  assert.equal(game.animationUntil,now+3*240);
  assert.equal((await act(game,'chanceContinue')).status,400);
  now+=10000;assert.equal((await act(game,'buy')).status,200);
  assert.equal(game.owners[1],'alice');assert.equal(game.players[0].money,6400);
});

test('chance movement skips occupied companies and ends the turn if none are available', async () => {
  const game=fixture();game.players[0].position=2;game.owners={3:'bob',5:'alice'};
  game.phase='chanceResult';game.chanceResult={id:'nearest-company',title:'Новые возможности',description:'Вперёд',amount:0,playerId:'alice',movement:'nearestAvailableCompany'};
  await act(game,'chanceContinue');assert.equal(game.players[0].position,6);assert.equal(game.phase,'buy');
  const full=fixture();full.players[0].position=2;
  for(let i=0;i<40;i++)if(tiles[i].price)full.owners[i]='bob';
  full.phase='chanceResult';full.chanceResult={id:'nearest-company',title:'Новые возможности',description:'Вперёд',amount:0,playerId:'alice',movement:'nearestAvailableCompany'};
  await act(full,'chanceContinue');assert.equal(full.players[0].position,2);assert.equal(full.turn,1);assert.equal(full.phase,'roll');
});

test('each player counts only their own dice rolls, including a jail attempt', async t => {
  let now=10000;t.mock.method(Date,'now',()=>now);const rolls=[0,0.2,0,0.2];t.mock.method(Math,'random',()=>rolls.shift()??0);
  const game=fixture();game.players[0].jailed=true;game.phase='jail';
  assert.equal((await act(game,'jailRoll',{},'bob')).status,400);
  assert.equal(game.players[0].turnsTaken,undefined);
  await act(game,'jailRoll');assert.equal(game.players[0].turnsTaken,1);assert.equal(game.players[1].turnsTaken,undefined);
  now+=10000;await act(game,'roll');assert.equal(game.players[1].turnsTaken,1);assert.equal(game.players[0].turnsTaken,1);
});
