import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../app/api/game/route';
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

test('surrender during a duel cancels it and refunds both stakes before elimination', async () => {
  const game=fixture();game.players.push({id:'carol',name:'Каролина',color:'#aaa',money:15000,position:0});
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:700})).status,200);
  const duelId=game.duel!.id;
  assert.equal((await act(game,'duelRespond',{duelId,accept:true},'bob')).status,200);
  assert.equal((await act(game,'surrender',{},'bob')).status,200);
  assert.equal(game.players[0].money,15000);assert.equal(game.players[1].bankrupt,true);
  assert.equal(game.duel,undefined);assert.equal(game.phase,'roll');assert.equal(game.turn,0);
});

test('duel accepts an adjustable bet, pays once, and preserves the ordinary turn and dice', async t => {
  let now=10000;const values=[0.34,0.68,0.17,0.51]; // 3+5 beats 2+4.
  t.mock.method(Date,'now',()=>now);t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();game.dice=[2,2];game.rollSeq=7;game.players[0].doubles=2;
  game.players[0].loan={principal:3000,totalDue:3300,turnsLeft:4};
  game.owners={1:'alice'};game.mortgaged=[1];game.mortgageTurns={1:8};
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:700})).status,200);
  assert.equal(game.phase,'duelInvite');assert.equal(game.duel?.bet,700);
  assert.deepEqual(game.players.map(p=>p.money),[15000,15000]);
  const duelId=game.duel!.id,serial=game.turnSerial;
  assert.equal((await act(game,'duelRespond',{duelId,accept:true})).status,400);
  assert.equal((await act(game,'duelRespond',{duelId:'stale',accept:true},'bob')).status,400);
  assert.equal((await act(game,'roll')).status,400);
  assert.equal((await act(game,'loanTake')).status,400);
  assert.equal((await act(game,'unmortgage',{tile:1})).status,400);
  assert.equal((await act(game,'chat',{message:'Смотрим дуэль'},'bob')).status,200);
  assert.equal((await act(game,'duelRespond',{duelId,accept:true},'bob')).status,200);
  assert.equal(game.phase,'duelResult');
  assert.deepEqual(game.duel?.dice,[[3,5],[2,4]]);assert.equal(game.duel?.winner,'alice');
  assert.deepEqual(game.players.map(p=>p.money),[14300,14300]);
  assert.equal((await act(game,'duelRespond',{duelId,accept:true},'bob')).status,400);
  assert.equal((await act(game,'duelContinue',{duelId})).status,400);
  now+=10000;
  assert.equal((await act(game,'duelContinue',{duelId},'bob')).status,400);
  assert.equal((await act(game,'duelContinue',{duelId:'stale'})).status,400);
  assert.equal((await act(game,'duelContinue',{duelId})).status,200);
  assert.deepEqual(game.players.map(p=>p.money),[15700,14300]);
  assert.equal(game.phase,'roll');assert.equal(game.turn,0);assert.equal(game.turnSerial,serial);
  assert.deepEqual(game.dice,[2,2]);assert.equal(game.rollSeq,7);assert.equal(game.players[0].position,0);
  assert.equal(game.players[0].doubles,2);assert.equal(game.players[0].loan?.turnsLeft,4);
  assert.equal(game.mortgageTurns?.[1],8);assert.equal(game.duel,undefined);
  assert.equal((await act(game,'duelContinue',{duelId})).status,400);
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:100})).status,400);
  assert.equal((await act(game,'roll')).status,200);
  assert.equal(game.rollSeq,8);
});

test('duel pays the opponent or refunds a tie without creating or losing money', async t => {
  let now=10000,values:number[]=[];
  t.mock.method(Date,'now',()=>now);t.mock.method(Math,'random',()=>values.shift()??0);
  for(const [dice,balances,winner] of [
    [[0,0.17,0.99,0.99],[14100,15900],'bob'],
    [[0.34,0.51,0.99,0],[15000,15000],undefined],
  ] as const) {
    const game=fixture();values=[...dice];
    assert.equal((await act(game,'duelChallenge',{to:'bob',bet:900})).status,200);
    const duelId=game.duel!.id;
    await act(game,'duelRespond',{duelId,accept:true},'bob');
    assert.equal(game.duel?.winner,winner);now+=10000;
    await act(game,'duelContinue',{duelId});
    assert.deepEqual(game.players.map(p=>p.money),balances);
    assert.equal(game.players.reduce((sum,p)=>sum+p.money,0),30000);
    assert.equal(game.phase,'roll');assert.equal(game.turn,0);
  }
});

test('duel validates stakes, parties, phases, movement and active contracts', async () => {
  const game=fixture();game.players[1].money=950;
  for(const bet of [-100,0,50,150,100.5,1000,Number.MAX_SAFE_INTEGER,'invalid']) {
    assert.equal((await act(game,'duelChallenge',{to:'bob',bet})).status,400);
    assert.equal(game.phase,'roll');assert.equal(game.duel,undefined);
  }
  assert.equal((await act(game,'duelChallenge',{to:'alice',bet:500})).status,400);
  assert.equal((await act(game,'duelChallenge',{to:'missing',bet:500})).status,400);
  assert.equal((await act(game,'duelChallenge',{to:'alice',bet:500},'bob')).status,400);
  game.players[1].bankrupt=true;
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,400);
  game.players[1].bankrupt=false;
  game.started=false;
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,400);
  game.started=true;
  for(const phase of ['buy','pay','auction','jail','finished'] as const) {
    game.phase=phase;assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,400);
  }
  game.phase='roll';game.animationUntil=Date.now()+10000;
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,400);
  game.animationUntil=0;
  game.trade={from:'alice',to:'bob',give:[],take:[],giveCash:0,takeCash:0};
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,400);
  game.trade=undefined;
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:900})).status,200);
});

test('duel rejection and cancellation are free, reject stale responses and consume one challenge per turn', async () => {
  for(const cancelled of [false,true]) {
    const game=fixture();
    assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,200);
    const duelId=game.duel!.id;
    assert.equal((await act(game,'duelCancel',{duelId},'bob')).status,400);
    const result=cancelled?await act(game,'duelCancel',{duelId}):await act(game,'duelRespond',{duelId,accept:false},'bob');
    assert.equal(result.status,200);assert.equal(game.phase,'roll');assert.equal(game.turn,0);
    assert.deepEqual(game.players.map(p=>p.money),[15000,15000]);
    assert.equal((await act(game,'duelRespond',{duelId,accept:true},'bob')).status,400);
    assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,400);
    game.phase='pay';game.debt={amount:1,reason:'test'};await act(game,'pay');
    game.phase='pay';game.debt={amount:1,reason:'test'};await act(game,'pay');
    assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,200);
  }
});

test('duel rechecks cash on acceptance and allows cancellation after a failed acceptance', async () => {
  const game=fixture();
  assert.equal((await act(game,'duelChallenge',{to:'bob',bet:700})).status,200);
  const duelId=game.duel!.id;game.players[1].money=600;
  assert.equal((await act(game,'duelRespond',{duelId,accept:true},'bob')).status,400);
  assert.deepEqual(game.players.map(p=>p.money),[15000,600]);assert.equal(game.phase,'duelInvite');
  assert.equal((await act(game,'duelCancel',{duelId})).status,200);
  assert.equal(game.phase,'roll');
});

test('bots automatically accept funded duels and decline when cash is no longer sufficient', async t => {
  let now=10000;t.mock.method(Date,'now',()=>now);t.mock.method(Math,'random',()=>0);
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{callbacks.push(callback);return {} as ReturnType<typeof setTimeout>});
  for(const funded of [true,false]) {
    const game=fixture();game.players[1].bot=true;
    assert.equal((await act(game,'duelChallenge',{to:'bob',bet:500})).status,200);
    const duelId=game.duel!.id;
    if(!funded)game.players[1].money=400;
    assert.equal(callbacks.length,1);await callbacks.shift()!();
    if(funded){
      assert.equal(game.phase,'duelResult');now+=10000;
      assert.equal((await act(game,'duelContinue',{duelId})).status,200);
      assert.deepEqual(game.players.map(p=>p.money),[15000,15000]);
    }else{
      assert.equal(game.phase,'roll');assert.deepEqual(game.players.map(p=>p.money),[15000,400]);
    }
    assert.equal(game.phase,'roll');assert.equal(callbacks.length,0);
  }
});

test('jackpot cell chooses numbers or roulette at the 50 percent boundary', async t => {
  let values:number[]=[];
  t.mock.method(Math,'random',()=>values.shift()??0);
  for (const [random,phase] of [[0,'jackpot'],[0.499999,'jackpot'],[0.5,'roulette'],[0.999999,'roulette']] as const) {
    const game=fixture();
    game.players[0].position=17;
    values=[0,0.2,random]; // 1 + 2 lands on the jackpot cell.
    assert.equal((await act(game,'roll')).status,200);
    assert.equal(game.players[0].position,20);
    assert.equal(game.phase,phase);
    assert.equal(game.players[0].money,15000);
  }
});

test('roulette follows the agreed percentages and pays each result exactly once', async t => {
  let now=10000, random=0;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(Math,'random',()=>random);
  const expected=[
    {id:'empty',from:0,to:30,money:14000},
    {id:'refund',from:30,to:60,money:15000},
    {id:'prize',from:60,to:75,money:16000},
    {id:'extraRoll',from:75,to:85,money:15000},
    {id:'start',from:85,to:90,money:17000},
    {id:'jackpot',from:90,to:95,money:19000},
    {id:'jail',from:95,to:100,money:14000},
  ];
  for (const outcome of expected) {
    for (let bucket=outcome.from;bucket<outcome.to;bucket++) {
     for (const offset of [0,0.999999]) {
      const game=fixture();
      game.phase='roulette';game.players[0].position=20;
      random=(bucket+offset)/100;
      assert.equal((await act(game,'rouletteSpin',{outcome:'jackpot'})).status,200);
      assert.equal(game.phase,'rouletteResult');
      assert.equal(game.rouletteResult?.outcome,outcome.id,`percentile ${bucket}, offset ${offset}`);
      assert.equal(game.players[0].money,outcome.money);
      assert.equal((await act(game,'rouletteSpin')).status,400);
      assert.equal((await act(game,'rouletteContinue')).status,400);
      now+=10000;
      assert.equal((await act(game,'rouletteContinue',{},'bob')).status,400);
      assert.equal((await act(game,'rouletteContinue')).status,200);
      assert.equal(game.players[0].money,outcome.money);
      assert.equal((await act(game,'rouletteContinue',{},'alice')).status,400);
      assert.equal(game.players[0].money,outcome.money);
      assert.equal(game.debt,undefined);
      if(outcome.id==='extraRoll') {
        assert.equal(game.turn,0);assert.equal(game.phase,'roll');
      } else {
        assert.equal(game.turn,1);assert.equal(game.phase,'roll');
      }
      assert.equal(game.players[0].position,outcome.id==='start'?0:outcome.id==='jail'?10:20);
      assert.equal(!!game.players[0].jailed,outcome.id==='jail');
      assert.ok(game.log.some(line=>line.includes('рулетка')));
     }
    }
  }
});

test('roulette saves a random stop within the chosen sector, independent of the outcome and client input', async t => {
  t.mock.method(Date,'now',()=>10000);
  let values:number[]=[];
  t.mock.method(Math,'random',()=>values.shift()??0.5);
  const positions:number[]=[];
  for(const [random,expected] of [[0,0.1],[0.25,0.3],[0.75,0.7],[0.999999,0.8999992]]) {
    const game=fixture();game.phase='roulette';game.players[0].position=20;
    values=[0.8,random]; // Same extra-roll outcome, independently varied landing point.
    assert.equal((await act(game,'rouletteSpin',{outcome:'jackpot',stopPosition:0.5})).status,200);
    assert.equal(game.rouletteResult?.outcome,'extraRoll');
    const position=game.rouletteResult?.stopPosition;
    assert.equal(typeof position,'number');
    assert.ok(Math.abs(position!-expected)<1e-9);
    assert.ok(position!>=0.1&&position!<0.9,'Keep a safe distance from adjacent sectors');
    positions.push(position!);
    assert.equal(game.players[0].money,15000);
    const saved=structuredClone(game.rouletteResult);
    const response=await GET(new Request(`http://localhost/api/game?room=${game.code}`));
    assert.deepEqual((await response.json()).rouletteResult,saved);
    assert.equal((await act(game,'rouletteSpin')).status,400);
    assert.deepEqual(game.rouletteResult,saved,'A retry must not reroll the landing point');
  }
  assert.equal(new Set(positions).size,4);
});

test('roulette requires the active player, completed movement, and a funded stake; skipping is free', async t => {
  t.mock.method(Date,'now',()=>10000);
  const game=fixture();game.phase='roulette';game.players[0].position=20;
  assert.equal((await act(game,'rouletteSpin',{},'bob')).status,400);
  assert.equal((await act(game,'rouletteSkip',{},'bob')).status,400);
  assert.equal((await act(game,'jackpotBet',{numbers:[1]})).status,400);
  game.animationUntil=12000;
  assert.equal((await act(game,'rouletteSpin')).status,400);
  assert.equal((await act(game,'rouletteSkip')).status,400);
  game.animationUntil=0;game.players[0].money=999;
  assert.equal((await act(game,'rouletteSpin')).status,400);
  assert.equal(game.players[0].money,999);
  assert.equal((await act(game,'rouletteSkip')).status,200);
  assert.equal(game.players[0].money,999);
  assert.equal(game.turn,1);
});

test('roulette extra roll stacks with doubles; jail cancels all extra rolls without a start reward', async t => {
  let now=10000;
  t.mock.method(Date,'now',()=>now);
  const random=t.mock.method(Math,'random',()=>0.8);
  const game=fixture();game.phase='roulette';game.players[0].position=20;
  game.players[0].doubles=1;game.extraTurn='alice';
  await act(game,'rouletteSpin');now+=10000;
  await act(game,'rouletteContinue');
  assert.equal(game.turn,0);
  assert.equal(game.players[0].money,15000);
  // Complete the turn earned by doubles; the roulette roll must remain available.
  game.phase='pay';game.debt={amount:1,reason:'Rent'};
  await act(game,'pay');
  assert.equal(game.turn,0);assert.equal(game.phase,'roll');
  game.phase='pay';game.debt={amount:1,reason:'Rent'};
  await act(game,'pay');assert.equal(game.turn,1);

  const jail=fixture();jail.phase='roulette';jail.players[0].position=20;
  jail.extraTurn='alice';jail.players[0].doubles=2;
  random.mock.mockImplementation(()=>0.95);
  await act(jail,'rouletteSpin');now+=10000;
  await act(jail,'rouletteContinue');
  assert.equal(jail.turn,1);assert.equal(jail.extraTurn,undefined);
  assert.equal(jail.players[0].position,10);
  assert.equal(jail.players[0].money,14000);
  assert.equal(jail.players[0].jailed,true);
  assert.equal(jail.players[0].jailAttempts,0);
  assert.equal(jail.players[0].doubles,0);
});

test('bots spin and acknowledge roulette, and skip when their cash is below the stake', async t => {
  let now=10000;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(Math,'random',()=>0.65);
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{
    callbacks.push(callback);return {} as ReturnType<typeof setTimeout>;
  });
  for (const cash of [15000,999]) {
    const game=fixture();game.phase='roulette';game.players[0].position=20;
    game.players[0].bot=true;game.players[0].money=cash;
    await act(game,'chat',{message:'Test'},'bob');
    assert.equal(callbacks.length,1);
    await callbacks.shift()!();
    if(cash>=1000){
      assert.equal(game.phase,'rouletteResult');
      now+=10000;assert.equal(callbacks.length,1);
      await callbacks.shift()!();
      assert.equal(game.players[0].money,16000);
    }else assert.equal(game.players[0].money,999);
    assert.equal(game.turn,1);assert.equal(game.phase,'roll');
    assert.equal(callbacks.length,0);
  }
});

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
  const values=[0.34,0.51,7.1/14]; // Insurance: -400.
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

test('chance has 15 independent equally likely events and portfolio-based amounts', t => {
  const game=fixture(),player=game.players[0];
  assert.equal(CHANCE_CARDS.length,15);
  assert.equal(new Set(CHANCE_CARDS.map(card=>card.id)).size,15);
  const random=t.mock.method(Math,'random',()=>0);
  for(let i=0;i<CHANCE_CARDS.length;i++) {
    random.mock.mockImplementation(()=>(i+0.5)/CHANCE_CARDS.length);
    assert.equal(drawChance(game,player).id,CHANCE_CARDS[i].id);
  }
  random.mock.mockImplementation(()=>0);
  const first=drawChance(game,player);
  game.lastChanceId=first.id;
  assert.equal(drawChance(game,player).id,first.id);
  game.lastChanceId=undefined;
  game.owners={1:'alice',3:'alice',39:'bob'};
  game.levels={1:2,3:5,39:5};
  random.mock.mockImplementation(()=>10.1/15);
  assert.equal(drawChance(game,player).amount,-1300);
  random.mock.mockImplementation(()=>5.1/15);
  assert.equal(drawChance(game,player).amount,400);
});

test('chance skips exactly the next turn, advancing loan and mortgage counters without consuming a reverse move', async t => {
  let now=10000; t.mock.method(Date,'now',()=>now);
  const values=[0.34,0.51,14.5/15];t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();const alice=game.players[0];
  alice.loan={principal:5000,totalDue:5500,turnsLeft:4};alice.reverseNextMove=false;
  game.owners[1]='alice';game.mortgaged=[1];game.mortgageTurns={1:4};
  assert.equal((await act(game,'roll')).status,200);assert.equal(game.chanceResult?.skipNextTurn,true);
  now+=10000;assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.turn,1);assert.equal(alice.skipNextTurn,true);
  assert.equal(alice.loan?.turnsLeft,3);assert.equal(game.mortgageTurns[1],3);
  alice.reverseNextMove=true;
  game.phase='pay';game.debt={amount:1,reason:'test'};game.animationUntil=0;
  assert.equal((await act(game,'pay')).status,200);
  assert.equal(game.turn,1);assert.equal(alice.skipNextTurn,undefined);assert.equal(alice.reverseNextMove,true);
  assert.equal(alice.turnsTaken,1);assert.equal(alice.loan?.turnsLeft,2);assert.equal(game.mortgageTurns[1],2);
  assert.ok(game.log.some(line=>line.includes('Алиса пропускает ход')));
  game.phase='pay';game.debt={amount:1,reason:'test'};
  assert.equal((await act(game,'pay')).status,200);assert.equal(game.turn,0);assert.equal(game.phase,'roll');
});

test('a skip chance consumes an immediate extra turn once and keeps later bonus turns', async () => {
  const game=fixture();game.phase='chanceResult';game.extraTurn='alice';game.bonusRolls=1;
  game.chanceResult={id:'skip-turn',title:'Пауза',description:'',amount:0,playerId:'alice',skipNextTurn:true};
  assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.turn,0);assert.equal(game.phase,'roll');assert.equal(game.players[0].skipNextTurn,undefined);
  assert.ok(game.log.some(line=>line.includes('пропускает ход')));
});

test('skipping in jail preserves jail and defers a due loan until the next playable turn', async () => {
  const game=fixture(),alice=game.players[0];alice.position=10;alice.jailed=true;alice.jailAttempts=1;
  alice.skipNextTurn=true;alice.loan={principal:5000,totalDue:5500,turnsLeft:1};
  game.turn=1;game.phase='pay';game.debt={amount:1,reason:'test'};
  assert.equal((await act(game,'pay')).status,200);
  assert.equal(game.turn,1);assert.equal(alice.skipNextTurn,undefined);assert.equal(alice.jailed,true);
  assert.equal(alice.jailAttempts,1);assert.equal(alice.loan?.turnsLeft,0);
  game.phase='pay';game.debt={amount:1,reason:'test'};
  assert.equal((await act(game,'pay')).status,200);
  assert.equal(game.turn,0);assert.equal(game.phase,'pay');assert.equal(game.debt?.kind,'loan');
  assert.equal((await act(game,'pay')).status,200);assert.equal(game.phase,'jail');
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
  assert.equal(game.animationUntil,now+3*190);
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

test('forward crossing or landing on start counts a lap and a landing for each player', async t => {
  let values=[0,0.2];t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();game.players[0].position=38;
  assert.equal((await act(game,'roll')).status,200);
  assert.equal(game.players[0].position,1);assert.equal(game.players[0].lapsCompleted,1);
  assert.equal(game.tileVisits?.[1],1);assert.equal(game.players[1].lapsCompleted,undefined);
  const exact=fixture();exact.players[0].position=37;values=[0,0.2];
  assert.equal((await act(exact,'roll')).status,200);
  assert.equal(exact.players[0].position,0);assert.equal(exact.players[0].lapsCompleted,1);assert.equal(exact.tileVisits?.[0],1);
});

test('chance movement crossing start counts a lap and records the destination once', async () => {
  const game=fixture();game.players[0].position=38;game.owners[39]='bob';game.phase='chanceResult';
  game.chanceResult={id:'nearest-company',title:'Новые возможности',description:'',amount:0,playerId:'alice',movement:'nearestAvailableCompany'};
  assert.equal((await act(game,'chanceContinue')).status,200);
  assert.equal(game.players[0].lapsCompleted,1);assert.deepEqual(game.tileVisits,{1:1});
  game.animationUntil=0;assert.equal((await act(game,'buy')).status,200);assert.deepEqual(game.tileVisits,{1:1});
});

test('reverse movement and roulette transfers do not count as laps; police and jail are both landings', async t => {
  let values=[0,0.2];t.mock.method(Math,'random',()=>values.shift()??0);
  const reverse=fixture();reverse.players[0].position=2;reverse.players[0].reverseNextMove=true;
  await act(reverse,'roll');assert.equal(reverse.players[0].lapsCompleted,undefined);assert.deepEqual(reverse.tileVisits,{39:1});
  const police=fixture();police.players[0].position=27;values=[0,0.2];
  await act(police,'roll');assert.deepEqual(police.tileVisits,{10:1,30:1});
  const roulette=fixture();roulette.players[0].position=20;roulette.phase='rouletteResult';
  roulette.rouletteResult={playerId:'alice',outcome:'start'};
  assert.equal((await act(roulette,'rouletteContinue')).status,200);
  assert.equal(roulette.players[0].lapsCompleted,undefined);assert.deepEqual(roulette.tileVisits,{0:1});
});

test('multiple players landing on the same tile contribute to the same total', async t => {
  t.mock.method(Math,'random',(()=>{const values=[0,0.2,0,0.2];return()=>values.shift()??0})());
  const game=fixture();await act(game,'roll');game.animationUntil=0;await act(game,'buy');
  await act(game,'roll');assert.equal(game.tileVisits?.[3],2);
});


test('a reverse chance card affects only the next roll and then restores normal movement', async t => {
  let now=10000;t.mock.method(Date,'now',()=>now);
  const rolls=[0.34,0.51,13.1/15,0,0.2,0,0.2];t.mock.method(Math,'random',()=>rolls.shift()??0);
  const game=fixture();
  await act(game,'roll');assert.equal(game.players[0].position,7);
  assert.equal(game.chanceResult?.id,'reverse-direction');assert.equal(game.chanceResult?.reverseNextMove,true);
  now+=10000;assert.equal((await act(game,'chanceContinue',{},'bob')).status,400);
  assert.equal((await act(game,'chanceContinue')).status,200);assert.equal(game.players[0].reverseNextMove,true);assert.equal(game.turn,1);
  game.turn=0;game.phase='roll';now+=10000;await act(game,'roll');
  assert.equal(game.players[0].position,4);assert.equal(game.move?.direction,-1);assert.equal(game.players[0].reverseNextMove,undefined);assert.equal(game.phase,'pay');
  now+=10000;await act(game,'pay');game.turn=0;game.phase='roll';now+=10000;await act(game,'roll');
  assert.equal(game.players[0].position,7);assert.equal(game.move?.direction,undefined);
});

test('moving backwards across start does not award salary', async t => {
  t.mock.method(Math,'random',(()=>{const rolls=[0,0.2];return()=>rolls.shift()??0})());
  const game=fixture();game.players[0].position=2;game.players[0].reverseNextMove=true;
  await act(game,'roll');assert.equal(game.players[0].position,39);assert.equal(game.players[0].money,15000);
  assert.equal(game.phase,'buy');assert.equal(game.move?.direction,-1);
});

test('a reverse roll into the police square uses the correct landing before transfer', async t => {
  t.mock.method(Math,'random',(()=>{const rolls=[0,0.2];return()=>rolls.shift()??0})());
  const game=fixture();game.players[0].position=33;game.players[0].reverseNextMove=true;
  await act(game,'roll');assert.equal(game.players[0].position,10);assert.equal(game.players[0].jailed,true);
  assert.equal(game.move?.direction,-1);assert.equal(game.move?.jailTransfer,true);
});

test('reverse direction applies to forced jail exit and is consumed by a failed jail roll', async t => {
  let now=10000;t.mock.method(Date,'now',()=>now);
  const rolls=[0,0.2,0,0.2,0];t.mock.method(Math,'random',()=>rolls.shift()??0);
  const failed=fixture();failed.players[0].jailed=true;failed.players[0].position=10;failed.players[0].reverseNextMove=true;failed.phase='jail';
  await act(failed,'jailRoll');assert.equal(failed.players[0].reverseNextMove,undefined);assert.equal(failed.players[0].position,10);
  const forced=fixture();forced.players[0].jailed=true;forced.players[0].jailAttempts=2;forced.players[0].position=10;forced.players[0].reverseNextMove=true;forced.phase='jail';
  await act(forced,'jailRoll');assert.equal(forced.players[0].reverseNextMove,undefined);assert.equal(forced.debt?.moveDirection,-1);
  now+=10000;await act(forced,'pay');assert.equal(forced.players[0].position,7);assert.equal(forced.move?.direction,-1);assert.equal(forced.players[0].jailed,false);
});
