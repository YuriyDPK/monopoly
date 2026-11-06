import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/api/game/route';
import type { Game, Trade } from '../lib/game';

let sequence = 0;
function fixture(): Game {
  const game: Game = {
    code: `TRADE${++sequence}`,
    players: [
      {id:'alice',name:'Алиса',color:'#fff',money:15000,position:0},
      {id:'bob',name:'Боб',color:'#000',money:15000,position:0},
      {id:'carol',name:'Каролина',color:'#ccc',money:15000,position:0},
    ],
    host:'alice',started:true,turn:0,phase:'roll',owners:{37:'alice',39:'bob',1:'carol'},
    levels:{},turnSerial:1,lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0,
  };
  (globalThis as typeof globalThis & {monopolyRooms:Map<string,Game>}).monopolyRooms.set(game.code,game);
  return game;
}

async function act(game: Game, action: string, extra: Record<string,unknown> = {}, id = 'alice') {
  const response = await POST(new Request('http://localhost/api/game', {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,room:game.code,id,...extra}),
  }));
  return {status:response.status,body:await response.json()};
}

const offer = {to:'bob',give:[],take:[39],giveCash:3000,takeCash:0};
const counter = {to:'alice',give:[39],take:[37],giveCash:0,takeCash:4000};
const finances = (game: Game) => ({balances:game.players.map(player=>player.money),owners:{...game.owners}});

test('a counteroffer changes the sender and terms, then transfers assets exactly once on acceptance', async () => {
  const game=fixture(),before=finances(game);
  assert.equal((await act(game,'trade',{trade:offer})).status,200);
  const initialId=game.trade!.id;
  assert.equal((await act(game,'tradeCounter',{tradeId:initialId,trade:counter},'bob')).status,200);
  const revised=game.trade!;
  assert.notEqual(revised.id,initialId);
  assert.deepEqual(revised,{id:revised.id,counterOf:initialId,from:'bob',...counter});
  assert.deepEqual(finances(game),before);
  assert.equal(game.turn,0);assert.equal(game.turnSerial,1);assert.equal(game.phase,'roll');
  assert.equal((await act(game,'tradeResponse',{tradeId:revised.id,accept:true})).status,200);
  assert.deepEqual(finances(game),{balances:[11000,19000,15000],owners:{37:'bob',39:'alice',1:'carol'}});
  assert.equal(game.trade,undefined);
  assert.equal((await act(game,'tradeResponse',{tradeId:revised.id,accept:true})).status,400);
  assert.deepEqual(game.players.map(player=>player.money),[11000,19000,15000]);
});

test('negotiation can go back and forth while stale responses cannot affect the latest offer', async () => {
  const game=fixture();await act(game,'trade',{trade:offer});
  const first=game.trade!.id;
  await act(game,'tradeCounter',{tradeId:first,trade:counter},'bob');
  const second=game.trade!.id;
  assert.equal((await act(game,'tradeCounter',{tradeId:second,trade:{...offer,giveCash:3500}})).status,200);
  const latest=structuredClone(game.trade);
  assert.equal(latest?.counterOf,second);assert.equal(latest?.from,'alice');assert.equal(latest?.to,'bob');
  for(const tradeId of [first,second,undefined]) {
    for(const accept of [true,false]) assert.equal((await act(game,'tradeResponse',{tradeId,accept},'bob')).status,400);
    assert.equal((await act(game,'cancelTrade',{tradeId})).status,400);
    assert.equal((await act(game,'tradeCounter',{tradeId,trade:counter},'bob')).status,400);
  }
  assert.deepEqual(game.trade,latest);
  assert.equal((await act(game,'tradeResponse',{tradeId:latest?.id,accept:true},'bob')).status,200);
  assert.deepEqual(game.players.map(player=>player.money),[11500,18500,15000]);
});

test('only the recipient can counter and only the sender can cancel their current offer', async () => {
  const game=fixture();await act(game,'trade',{trade:offer});
  const trade=structuredClone(game.trade),tradeId=trade!.id;
  for(const id of ['alice','carol']) {
    assert.equal((await act(game,'tradeCounter',{tradeId,trade:counter},id)).status,400);
    assert.equal((await act(game,'tradeResponse',{tradeId,accept:true},id)).status,400);
  }
  assert.equal((await act(game,'tradeCounter',{tradeId,trade:{...counter,to:'carol'}},'bob')).status,400);
  assert.equal((await act(game,'trade',{trade:{to:'bob',give:[1],take:[],giveCash:0,takeCash:0}},'carol')).status,400);
  assert.equal((await act(game,'cancelTrade',{tradeId},'bob')).status,400);
  assert.deepEqual(game.trade,trade);
  assert.equal((await act(game,'cancelTrade',{tradeId})).status,200);
  assert.equal(game.trade,undefined);
  assert.equal((await act(game,'tradeCounter',{tradeId,trade:counter},'bob')).status,400);
});

test('invalid counteroffer cash, ownership and properties preserve the existing offer', async () => {
  const game=fixture();await act(game,'trade',{trade:offer});
  const trade=structuredClone(game.trade),before=finances(game),tradeId=trade!.id;
  const invalid = [
    {...counter,giveCash:-1},{...counter,takeCash:0.5},{...counter,takeCash:15001},
    {...counter,giveCash:'100'},{...counter,giveCash:null},{...counter,takeCash:Number.MAX_SAFE_INTEGER},
    {...counter,give:[37]},{...counter,take:[1]},{...counter,give:[39,39]},
    {...counter,give:[39.5]},{...counter,give:['39']},{...counter,take:[40]},
    {...counter,give:null},{...counter,take:{}},null,
  ];
  for(const terms of invalid) {
    assert.equal((await act(game,'tradeCounter',{tradeId,trade:terms},'bob')).status,400);
    assert.deepEqual(game.trade,trade);assert.deepEqual(finances(game),before);
  }
});

test('acceptance rechecks property ownership, available cash and auction commitments', async () => {
  for(const change of ['cash','ownership','auction'] as const) {
    const game=fixture();await act(game,'trade',{trade:offer});
    await act(game,'tradeCounter',{tradeId:game.trade!.id,trade:counter},'bob');
    const tradeId=game.trade!.id;
    if(change==='cash')game.players[0].money=3999;
    if(change==='ownership')game.owners[37]='carol';
    if(change==='auction'){game.phase='auction';game.auction={tile:3,bid:12000,bidder:'alice',passed:[]}}
    const before=finances(game);
    assert.equal((await act(game,'tradeResponse',{tradeId,accept:true})).status,400);
    assert.deepEqual(finances(game),before);assert.equal(game.trade?.id,tradeId);
    assert.equal((await act(game,'tradeResponse',{tradeId,accept:false})).status,200);
    assert.equal(game.trade,undefined);
  }
});

test('non-boolean acceptance and trading before start, after finish or with eliminated players are rejected', async () => {
  const game=fixture();await act(game,'trade',{trade:offer});
  const tradeId=game.trade!.id;
  for(const accept of ['false',1,null,undefined]) assert.equal((await act(game,'tradeResponse',{tradeId,accept},'bob')).status,400);
  for(const state of ['lobby','finished','sender-bankrupt','recipient-bankrupt'] as const) {
    const room=fixture();await act(room,'trade',{trade:offer});
    const trade=room.trade!;
    if(state==='lobby'){room.started=false;room.phase='lobby'}
    if(state==='finished')room.phase='finished';
    if(state==='sender-bankrupt')room.players[0].bankrupt=true;
    if(state==='recipient-bankrupt')room.players[1].bankrupt=true;
    assert.equal((await act(room,'tradeCounter',{tradeId:trade.id,trade:counter},'bob')).status,400);
    assert.equal((await act(room,'tradeResponse',{tradeId:trade.id,accept:true},'bob')).status,400);
    room.trade=undefined;
    assert.equal((await act(room,'trade',{trade:offer})).status,400);
  }
});

test('bankruptcy closes negotiations involving the eliminated player and returns their companies to the bank', async () => {
  for(const countered of [false,true]) {
    const game=fixture();game.mortgaged=[37];game.mortgageTurns={37:8};
    await act(game,'trade',{trade:offer});
    if(countered)await act(game,'tradeCounter',{tradeId:game.trade!.id,trade:counter},'bob');
    const tradeId=game.trade!.id;
    game.phase='pay';game.debt={amount:20000,to:'bob',reason:'Аренда'};
    assert.equal((await act(game,'bankrupt')).status,200);
    assert.equal(game.trade,undefined);assert.equal(game.players[0].bankrupt,true);
    assert.equal(game.owners[37],undefined);assert.equal(game.mortgaged.includes(37),false);
    assert.deepEqual(game.players.map(player=>player.money),[0,30000,15000]);
    assert.equal((await act(game,'tradeResponse',{tradeId,accept:true},'bob')).status,400);
  }
});

test('bots respond to the current trade id and can accept a counteroffer', async t => {
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{callbacks.push(callback);return {} as ReturnType<typeof setTimeout>});
  const game=fixture();game.players[1].bot=true;
  const original:Trade={id:'bot-offer',from:'bob',to:'alice',give:[39],take:[],giveCash:0,takeCash:6000};
  game.trade=original;
  assert.equal((await act(game,'tradeCounter',{tradeId:original.id,trade:{to:'bob',give:[],take:[39],giveCash:4500,takeCash:0}})).status,200);
  assert.equal(callbacks.length,1);
  await callbacks.shift()!();
  assert.equal(game.trade,undefined);assert.equal(game.owners[39],'alice');
  assert.deepEqual(game.players.map(player=>player.money),[10500,19500,15000]);
});
