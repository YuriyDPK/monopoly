import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../app/api/game/route';
import type { Game } from '../lib/game';

let sequence=0;
function fixture():Game {
  const game:Game={
    code:`AUCTION${++sequence}`,host:'alice',started:true,turn:0,turnSerial:1,phase:'auction',
    players:[
      {id:'alice',name:'Алиса',color:'#fff',money:10000,position:1},
      {id:'bob',name:'Боб',color:'#000',money:10000,position:0},
      {id:'cara',name:'Кара',color:'#ccc',money:10000,position:0},
    ],
    owners:{},levels:{},lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[],revision:0,
    auction:{tile:1,bid:600,bidder:'bob',passed:['alice'],seller:'alice'},
  };
  (globalThis as typeof globalThis & {monopolyRooms:Map<string,Game>}).monopolyRooms.set(game.code,game);
  return game;
}

async function act(game:Game,action:string,extra:Record<string,unknown>={},id='cara') {
  return POST(new Request('http://localhost/api/game',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,room:game.code,id,...extra}),
  }));
}

test('auction starts at the company price and requires raises of at least 100k',async()=>{
  const game=fixture();game.auction!.bid=0;delete game.auction!.bidder;
  for(const amount of [0,500,599,601,600.5]) {
    assert.equal((await act(game,'bid',{amount},'bob')).status,400);
    assert.equal(game.auction!.bid,0);
  }
  assert.equal((await act(game,'bid',{amount:600},'bob')).status,200);
  for(const amount of [600,602,650,699]) {
    assert.equal((await act(game,'bid',{amount})).status,400);
    assert.equal(game.auction!.bid,600);
  }
  assert.equal((await act(game,'bid',{amount:700})).status,200);
  assert.equal(game.auction!.bid,700);assert.equal(game.auction!.bidder,'cara');
  assert.deepEqual(game.players.map(player=>player.money),[10000,10000,10000]);
  assert.equal((await act(game,'bid',{amount:900},'bob')).status,200);
  assert.equal(game.auction!.bid,900);
});

test('older bids between 100k increments cannot be overbid by less than 100k',async()=>{
  const game=fixture();game.auction!.bid=650;
  assert.equal((await act(game,'bid',{amount:700})).status,400);
  assert.equal((await act(game,'bid',{amount:749})).status,400);
  assert.equal((await act(game,'bid',{amount:750})).status,400);
  assert.equal(game.auction!.bid,650);
  assert.equal((await act(game,'bid',{amount:800})).status,200);
  assert.equal(game.auction!.bid,800);
});

test('auction affordability and automatic passing use the full 100k increment',async()=>{
  const game=fixture();game.players[2].money=699;
  assert.equal((await act(game,'bid',{amount:700})).status,400);
  assert.equal(game.auction!.bid,600);assert.equal(game.players[2].money,699);
  await act(game,'chat',{message:'Аукцион'},'alice');
  assert.equal(game.auction,undefined);assert.equal(game.owners[1],'bob');
  assert.equal(game.players[1].money,9400);assert.equal(game.players[2].money,699);
  assert.ok(game.log.some(line=>line.includes('Кара автоматически пропускает аукцион')));

  const funded=fixture();funded.players[2].money=700;
  await act(funded,'chat',{message:'Ровно на следующий шаг'},'alice');
  assert.deepEqual(funded.auction!.passed,['alice']);
  assert.equal((await act(funded,'bid',{amount:700})).status,200);
  assert.equal(funded.auction!.bidder,'cara');
});

test('an underfunded bidder can mortgage property before offering the next 100k step',async()=>{
  const game=fixture();game.players[2].money=699;game.owners[3]='cara';
  await act(game,'chat',{message:'Есть имущество для залога'},'alice');
  assert.deepEqual(game.auction!.passed,['alice']);
  assert.equal((await act(game,'mortgage',{tile:3})).status,200);
  assert.equal(game.players[2].money,999);
  assert.equal((await act(game,'bid',{amount:700})).status,200);
  assert.equal(game.auction!.bidder,'cara');assert.equal(game.auction!.bid,700);
});

test('bots raise by 100k and pass rather than squeezing a smaller bid below their limit',async t=>{
  const callbacks:Array<()=>Promise<void>>=[];
  t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{callbacks.push(callback);return {} as ReturnType<typeof setTimeout>});
  const game=fixture();game.players[2].bot=true;
  await act(game,'chat',{message:'Ход бота'},'alice');
  assert.equal(callbacks.length,1);await callbacks.shift()!();
  assert.equal(game.auction!.bid,700);assert.equal(game.auction!.bidder,'cara');
  assert.equal(callbacks.length,0);

  const limited=fixture();limited.auction!.bid=700;limited.players[2].bot=true;
  await act(limited,'chat',{message:'Лимит бота 720k'},'alice');
  assert.equal(callbacks.length,1);await callbacks.shift()!();
  assert.equal(limited.auction,undefined);assert.equal(limited.owners[1],'bob');
  assert.equal(limited.players[1].money,9300);assert.equal(limited.players[2].money,10000);
});
