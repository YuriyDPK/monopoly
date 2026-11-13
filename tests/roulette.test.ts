import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { POST } from '../app/api/game/route';
import type { Game } from '../lib/game';

const rooms = (globalThis as typeof globalThis & {monopolyRooms:Map<string,Game>}).monopolyRooms;
const profiles = [
  {id:'new-human',money:1000,bot:false,history:false},
  {id:'rich-human',money:100000,bot:false,history:true},
  {id:'new-bot',money:1000,bot:true,history:false},
  {id:'rich-bot',money:100000,bot:true,history:true},
];
let sequence = 0;

function fixture(t:TestContext, profile:typeof profiles[number]):Game {
  const game:Game = {
    code:`FAIR${++sequence}`,players:[
      {id:profile.id,name:profile.id,money:profile.money,bot:profile.bot,color:'#fff',position:2},
      {id:'opponent',name:'Opponent',color:'#000',money:15000,position:0},
    ],host:profile.id,started:true,turn:0,phase:'roll',owners:{},levels:{},
    mortgaged:[],dice:[],log:[],revision:0,
  };
  if(profile.history) {
    game.owners={1:profile.id,3:profile.id};game.levels={1:3};
    game.rollSeq=200;game.turnSerial=200;
    game.log=[`${profile.id}: рулетка — Джекпот, выплата 5000k`];
    game.rouletteResult={playerId:profile.id,outcome:'jackpot'};
    game.jackpotResult={playerId:profile.id,choice:[1],result:1,payout:5000};
  }
  rooms.set(game.code,game);
  t.after(()=>rooms.delete(game.code));
  return game;
}

function controlledRandom(t:TestContext) {
  let values:number[]=[];
  t.mock.method(Date,'now',()=>10000);
  // These tests invoke bot actions directly, without running follow-up bot turns.
  t.mock.method(globalThis,'setTimeout',()=>({}) as ReturnType<typeof setTimeout>);
  const random=t.mock.method(Math,'random',()=>values.shift()??0);
  return {set:(next:number[])=>{values=[...next]},calls:()=>random.mock.callCount()};
}

async function act(game:Game,action:string,extra:Record<string,unknown>={}) {
  return POST(new Request('http://localhost/api/game',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({room:game.code,id:game.players[0].id,action,...extra}),
  }));
}

test('roulette uses the same odds for humans and bots regardless of wealth or past winnings',async t=>{
  const random=controlledRandom(t);
  for(const profile of profiles) for(const outcome of [
    {random:0.2,id:'empty',net:-1000},
    {random:0.65,id:'prize',net:1000},
    {random:0.92,id:'jackpot',net:4000},
  ]) {
    const game=fixture(t,profile);game.phase='roulette';game.players[0].position=20;
    random.set([outcome.random,0.25]);
    assert.equal((await act(game,'rouletteSpin',{outcome:'jackpot',payout:999999,stopPosition:0.9})).status,200);
    assert.equal(game.rouletteResult?.outcome,outcome.id,profile.id);
    assert.equal(game.players[0].money-profile.money,outcome.net);
    assert.ok(Math.abs(game.rouletteResult!.stopPosition!-0.3)<1e-9);
    const calls=random.calls(),result=structuredClone(game.rouletteResult);
    assert.equal((await act(game,'rouletteSpin')).status,400);
    assert.equal(random.calls(),calls,'A repeated request must not redraw the prize');
    assert.deepEqual(game.rouletteResult,result);
    assert.equal(game.players[0].money-profile.money,outcome.net);
  }
});
