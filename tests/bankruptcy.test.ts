import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/api/game/route';
import type { Game } from '../lib/game';

let sequence = 0;
function fixture(): Game {
  const game:Game={
    code:`BANKRUPTCY${++sequence}`,host:'alice',started:true,turn:0,turnSerial:3,phase:'pay',
    players:[
      {id:'alice',name:'Алиса',color:'#fff',money:1700,position:39,loanUsed:true},
      {id:'bob',name:'Боб',color:'#000',money:10000,position:0},
      {id:'carol',name:'Каролина',color:'#ccc',money:10000,position:0},
    ],
    owners:{1:'alice',3:'alice',39:'bob'},levels:{1:0,3:0,39:4},mortgaged:[1,3,39],
    mortgageTurns:{1:5,3:6,39:9},lastUpgradeTurn:{},dice:[3,4],debt:{amount:20000,to:'bob',reason:'Аренда'},
    log:[],revision:0,
  };
  (globalThis as typeof globalThis & {monopolyRooms:Map<string,Game>}).monopolyRooms.set(game.code,game);
  return game;
}

async function act(game:Game,action:string,extra:Record<string,unknown>={},id='alice') {
  const response=await POST(new Request('http://localhost/api/game',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,room:game.code,id,...extra}),
  }));
  return {status:response.status,body:await response.json()};
}

test('rent bankruptcy pays only the cash remainder once and returns clean companies to the bank',async()=>{
  const game=fixture();game.players[0].loan={principal:3000,totalDue:3300,turnsLeft:2};
  assert.equal((await act(game,'bankrupt')).status,200);
  assert.deepEqual(game.players.map(p=>p.money),[0,11700,10000]);
  assert.equal(game.players[0].bankrupt,true);assert.equal(game.players[0].loan,undefined);
  assert.deepEqual(game.owners,{39:'bob'});assert.deepEqual(game.levels,{39:4});
  assert.deepEqual(game.mortgaged,[39]);assert.deepEqual(game.mortgageTurns,{39:9});
  assert.ok(game.log.some(line=>line.includes('Боб получает 1700k')));
  assert.ok(game.log.some(line=>line.includes('Компании игрока Алиса возвращаются банку')));
  assert.equal(game.turn,1);assert.equal(game.phase,'roll');assert.equal(game.debt,undefined);
  assert.equal((await act(game,'bankrupt')).status,400);
  assert.equal((await act(game,'pay')).status,400);
  assert.deepEqual(game.players.map(p=>p.money),[0,11700,10000]);
});

test('bank debt and an invalid creditor cannot pay another player or inherit property',async()=>{
  for(const creditor of [undefined,'missing','alice','carol']) {
    const game=fixture();game.debt={amount:3300,to:creditor,reason:'Погашение кредита',kind:'loan'};
    if(creditor==='carol')game.players[2].bankrupt=true;
    assert.equal((await act(game,'bankrupt')).status,200);
    assert.deepEqual(game.players.map(p=>p.money),[0,10000,10000]);
    assert.deepEqual(game.owners,{39:'bob'});assert.equal(game.levels?.[1],undefined);
    assert.ok(game.log.some(line=>line.includes('1700k — возвращается банку')));
  }
});

test('voluntary liquidation proceeds are not added twice at bankruptcy',async()=>{
  const game=fixture();game.players[0].money=100;game.owners={1:'alice',39:'bob'};
  game.mortgaged=[];game.mortgageTurns={};game.levels={1:1};
  assert.equal((await act(game,'mortgage',{tile:1})).status,400);
  assert.equal((await act(game,'sellUpgrade',{tile:1})).status,200);
  assert.equal(game.players[0].money,350);
  assert.equal((await act(game,'mortgage',{tile:1})).status,200);
  assert.equal(game.players[0].money,650);
  assert.equal((await act(game,'bankrupt')).status,200);
  assert.equal(game.players[1].money,10650);assert.equal(game.owners[1],undefined);
  assert.equal(game.levels?.[1],undefined);assert.equal(game.mortgageTurns?.[1],undefined);
});

test('a player who can cover the debt cannot declare bankruptcy',async()=>{
  const game=fixture();game.debt!.amount=1700;
  const before=structuredClone(game);
  assert.equal((await act(game,'bankrupt')).status,400);
  assert.deepEqual(game,before);
});

test('bankruptcy closes related offers and counteroffers, preserving an unrelated negotiation',async()=>{
  for(const involved of ['sender','recipient','unrelated'] as const) {
    const game=fixture();
    const from=involved==='sender'?'alice':'bob',to=involved==='recipient'?'alice':'carol';
    game.trade={id:'latest',counterOf:'previous',from,to,give:[],take:[],giveCash:0,takeCash:0};
    const before=structuredClone(game.trade);
    assert.equal((await act(game,'bankrupt')).status,200);
    if(involved==='unrelated')assert.deepEqual(game.trade,before);else assert.equal(game.trade,undefined);
  }
});

test('elimination cancels extra turns, removes traps and advances to a living player',async()=>{
  const game=fixture();game.players[1].bankrupt=true;game.debt!.to='carol';
  game.extraTurn='alice';game.bonusRolls=2;game.players[0].doubles=3;
  game.traps=[{id:'trap',ownerId:'alice',tile:5,amount:1000,cost:200,placedAfter:{alice:0,bob:0,carol:0}}];
  assert.equal((await act(game,'bankrupt')).status,200);
  assert.equal(game.phase,'finished');assert.equal(game.winner,'carol');
  assert.equal(game.extraTurn,undefined);assert.equal(game.bonusRolls,undefined);assert.deepEqual(game.traps,[]);
  assert.equal(game.players[2].money,11700);

  const ongoing=fixture();ongoing.extraTurn='alice';ongoing.bonusRolls=2;
  ongoing.traps=[{id:'trap',ownerId:'alice',tile:5,amount:1000,cost:200,placedAfter:{alice:0,bob:0,carol:0}}];
  assert.equal((await act(ongoing,'bankrupt')).status,200);
  assert.equal(ongoing.turn,1);assert.equal(ongoing.phase,'roll');assert.equal(ongoing.turnSerial,4);
  assert.equal(ongoing.extraTurn,undefined);assert.equal(ongoing.bonusRolls,undefined);assert.deepEqual(ongoing.traps,[]);
});

test('bots use the same bankruptcy payout and return their properties to the bank',async t=>{
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{callbacks.push(callback);return {} as ReturnType<typeof setTimeout>});
  const game=fixture();game.players[0].bot=true;
  assert.equal((await act(game,'chat',{message:'Проверка бота'},'bob')).status,200);
  assert.equal(callbacks.length,1);await callbacks.shift()!();
  assert.equal(game.players[0].bankrupt,true);assert.deepEqual(game.players.map(p=>p.money),[0,11700,10000]);
  assert.deepEqual(game.owners,{39:'bob'});assert.equal(game.phase,'roll');assert.equal(game.turn,1);
});
