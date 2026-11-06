import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../app/api/game/route';
import type { Game } from '../lib/game';

let fixtureNumber=0;
const key=(id:string)=>`${id}-private-test-key-${'x'.repeat(32)}`;
function fixture():Game {
  const game:Game={code:`TRAPS${++fixtureNumber}`,players:[
    {id:'alice',name:'Алиса',color:'#ed515b',money:15000,position:0},
    {id:'bob',name:'Боб',color:'#35aeeb',money:15000,position:0},
    {id:'cara',name:'Кара',color:'#95ca50',money:15000,position:0},
  ],host:'alice',started:true,turn:0,phase:'roll',owners:{},levels:{},turnSerial:1,mortgaged:[],dice:[],log:[],revision:0};
  (globalThis as typeof globalThis&{monopolyRooms:Map<string,Game>}).monopolyRooms.set(game.code,game);return game;
}
async function act(game:Game,action:string,extra:Record<string,unknown>={},id=game.players[game.turn].id,privateKey=key(id)) {
  const response=await POST(new Request('http://localhost/api/game',{method:'POST',headers:{'Content-Type':'application/json','X-Player-Key':privateKey},body:JSON.stringify({action,id,room:game.code,...extra})}));
  return {status:response.status,body:await response.json()};
}
async function view(game:Game,id='',privateKey='') {
  return (await GET(new Request(`http://localhost/api/game?room=${game.code}&id=${id}`,{headers:{'X-Player-Key':privateKey}}))).json();
}
async function endTurn(game:Game) {
  game.phase='pay';game.debt={amount:1,reason:'Тест завершения хода'};game.animationUntil=0;
  assert.equal((await act(game,'pay')).status,200);
}

test('traps offer the four agreed amounts, charge 40 percent, and hide location, amount and reserved cash in every public response',async()=>{
  for(const [amount,cost] of [[500,200],[1000,400],[2000,800],[5000,2000]]) {
    const game=fixture();
    const placed=await act(game,'trapPlace',{tile:3,amount,cost:0,lifetime:999,cooldown:0});
    assert.equal(placed.status,200);assert.equal(game.players[0].money,15000-cost);
    assert.equal(placed.body.myTrap.tile,3);assert.equal(placed.body.myTrap.amount,amount);assert.equal(placed.body.myTrap.roundsLeft,10);
    assert.equal(placed.body.trapCooldown,10);assert.equal(placed.body.players[0].money,15000-cost);
    assert.equal(game.traps?.length,1);
    assert.equal(game.log[0],'Алиса устанавливает ловушку');
    for(const publicView of [await view(game),await view(game,'bob',key('bob')),await view(game,'alice'),await view(game,'alice',key('bob')),(await act(game,'chat',{message:'Смотрим ловушки'},'bob')).body,(await act(game,'join',{},'bob')).body]) {
      assert.equal(publicView.players[0].money,15000);assert.equal(publicView.myTrap,undefined);
      for(const field of ['traps','trapPlacements','completedTurns','privateKeys'])assert.equal(publicView[field],undefined);
      assert.ok(publicView.log.includes('Алиса устанавливает ловушку'));
    }
    const own=await view(game,'alice',key('alice'));assert.equal(own.myTrap.tile,3);assert.equal(own.players[0].money,15000-cost);
    assert.equal((await act(game,'trapPlace',{tile:6,amount},'alice',key('bob'))).status,400);
  }
});

test('trap installation validates the cell, amount, funds, active turn, movement and contracts without spending on rejection',async()=>{
  for(const amount of [-500,0,100,500.5,1500,10000,'500']) {
    const game=fixture();assert.equal((await act(game,'trapPlace',{tile:3,amount})).status,400);assert.equal(game.players[0].money,15000);
  }
  for(const tile of [-1,0,2,4,10,20,30,36,40,3.5,'3']) {
    const game=fixture();assert.equal((await act(game,'trapPlace',{tile,amount:500})).status,400);assert.equal(game.traps?.length||0,0);
  }
  const game=fixture();game.owners[3]='bob';assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);delete game.owners[3];
  game.players[0].money=199;assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);game.players[0].money=15000;
  assert.equal((await act(game,'trapPlace',{tile:3,amount:500},'bob')).status,400);
  game.started=false;assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);game.started=true;
  game.players[0].bankrupt=true;assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);game.players[0].bankrupt=false;
  game.players[0].jailed=true;assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);game.players[0].jailed=false;
  for(const phase of ['buy','pay','auction','jail','duelInvite','duelResult','roulette','finished'] as const){game.phase=phase;assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400)}
  game.phase='roll';game.animationUntil=Date.now()+10000;assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);game.animationUntil=0;
  game.trade={from:'alice',to:'bob',give:[],take:[],giveCash:0,takeCash:0};assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,400);game.trade=undefined;
  assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,200);
  assert.equal((await act(game,'trapPlace',{tile:6,amount:500})).status,400);
  assert.equal(game.players[0].money,14800);
});

test('a trap lasts until every living player completes ten rounds; extra turns do not advance rounds and placement unlocks after ten rounds',async()=>{
  const game=fixture();await act(game,'trapPlace',{tile:3,amount:500});
  game.extraTurn='alice';await endTurn(game);assert.equal(game.turn,0);
  assert.equal((await view(game,'alice',key('alice'))).myTrap.roundsLeft,10);
  assert.equal((await view(game,'alice',key('alice'))).trapCooldown,10);
  for(let round=1;round<=10;round++) {
    await endTurn(game);await endTurn(game);
    if(round===10){assert.equal(game.traps?.length,1);assert.equal((await view(game,'alice',key('alice'))).myTrap.roundsLeft,1)}
    await endTurn(game);
    const own=await view(game,'alice',key('alice'));
    assert.equal(own.trapCooldown,10-round);
    if(round<10){assert.equal(own.myTrap.roundsLeft,10-round)}else{assert.equal(own.myTrap,undefined);assert.equal(game.traps?.length,0)}
    if(round<10)assert.equal((await act(game,'trapPlace',{tile:6,amount:1000})).status,400);
  }
  assert.equal(game.players[0].money,14789); // 200k installation, 11 one-k test payments; no refund on expiry.
  assert.equal((await act(game,'trapPlace',{tile:6,amount:1000})).status,200);
  assert.equal((await view(game,'alice',key('alice'))).trapCooldown,10);
});

test('a trap survives nine full rounds and expires only when the last player finishes the tenth, unlocking a new installation',async()=>{
  const game=fixture();assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,200);
  for(let round=1;round<=9;round++){
    await endTurn(game);await endTurn(game);await endTurn(game);
    if(round===3){
      const own=await view(game,'alice',key('alice'));
      assert.ok(own.myTrap,'The trap must remain armed after three full rounds');
      assert.equal(own.myTrap.roundsLeft,7);
    }
  }
  const ninth=await view(game,'alice',key('alice'));assert.equal(ninth.myTrap.roundsLeft,1);assert.equal(ninth.trapCooldown,1);
  await endTurn(game);await endTurn(game);
  const beforeLast=await view(game,'alice',key('alice'));assert.equal(beforeLast.myTrap.roundsLeft,1);assert.equal(beforeLast.trapCooldown,1);
  await endTurn(game);
  const tenth=await view(game,'alice',key('alice'));assert.equal(tenth.myTrap,undefined);assert.equal(tenth.trapCooldown,0);assert.equal(game.traps?.length,0);
  const next=await act(game,'trapPlace',{tile:6,amount:1000});assert.equal(next.status,200);assert.equal(next.body.myTrap.roundsLeft,10);
});

test('a trap reveals once, creates a payable debt, pays its owner once, and resumes the landed company before advancing the turn',async t=>{
  let now=10000;t.mock.method(Date,'now',()=>now);const values=[0,0.17];t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();await act(game,'trapPlace',{tile:3,amount:1000});game.turn=1;
  assert.equal((await act(game,'roll')).status,200);assert.equal(game.players[1].position,3);
  assert.equal(game.phase,'pay');assert.equal(game.debt?.kind,'trap');assert.equal(game.debt?.amount,1000);assert.equal(game.debt?.to,'alice');
  assert.equal(game.traps?.length,0);assert.equal(game.trapResult?.ownerId,'alice');assert.equal(game.trapResult?.playerId,'bob');
  assert.deepEqual(game.players.map(p=>p.money),[14600,15000,15000]);
  assert.equal((await act(game,'pay')).status,400);now+=10000;
  assert.equal((await act(game,'pay')).status,200);assert.deepEqual(game.players.map(p=>p.money),[15600,14000,15000]);
  assert.equal(game.phase,'buy');assert.equal(game.turn,1);assert.equal(game.trapResult,undefined);assert.equal(game.debt,undefined);
  assert.equal((await act(game,'pay')).status,400);
  assert.equal((await act(game,'buy')).status,200);assert.equal(game.owners[3],'bob');assert.equal(game.players[1].money,13400);assert.equal(game.turn,2);
});

test('stepping on your own trap pays the bank and insufficient funds can be financed before the company action',async t=>{
  let now=10000;t.mock.method(Date,'now',()=>now);let values=[0,0.17];t.mock.method(Math,'random',()=>values.shift()??0);
  const self=fixture();await act(self,'trapPlace',{tile:3,amount:500});await act(self,'roll');now+=10000;
  assert.equal(self.debt?.to,undefined);await act(self,'pay');assert.deepEqual(self.players.map(p=>p.money),[14300,15000,15000]);assert.equal(self.phase,'buy');
  const game=fixture();values=[0,0.17];await act(game,'trapPlace',{tile:3,amount:5000});game.turn=1;game.players[1].money=300;game.owners[39]='bob';
  await act(game,'roll');now+=10000;assert.equal((await act(game,'pay')).status,400);
  assert.equal((await act(game,'loanTake')).status,200);assert.equal((await act(game,'pay')).status,400);
  assert.equal((await act(game,'mortgage',{tile:39})).status,200);assert.equal((await act(game,'pay')).status,200);
  assert.equal(game.players[1].money,300);assert.equal(game.players[0].money,18000);assert.equal(game.phase,'buy');assert.equal(game.turn,1);
});

test('bankrupt players do not delay expiration and a bankrupt owner removes the trap and public reserve',async()=>{
  const game=fixture();await act(game,'trapPlace',{tile:3,amount:500});game.players[1].bankrupt=true;
  for(let round=0;round<10;round++){await endTurn(game);assert.equal(game.turn,2);await endTurn(game)}
  assert.equal(game.traps?.length,0);
  const dead=fixture();await act(dead,'trapPlace',{tile:3,amount:500});dead.players[0].money=0;dead.players[0].loanUsed=true;dead.phase='pay';dead.debt={amount:500,reason:'Тест банкротства'};
  assert.equal((await act(dead,'bankrupt')).status,200);assert.equal(dead.traps?.length,0);assert.equal((await view(dead,'bob',key('bob'))).players[0].money,0);
});

test('secret traps on the same cell do not reveal each other during placement and only one triggers per landing',async t=>{
  let now=10000;t.mock.method(Date,'now',()=>now);const values=[0,0.17];t.mock.method(Math,'random',()=>values.shift()??0);
  const game=fixture();assert.equal((await act(game,'trapPlace',{tile:3,amount:500})).status,200);game.turn=2;
  assert.equal((await act(game,'trapPlace',{tile:3,amount:1000})).status,200);game.turn=1;
  await act(game,'roll');assert.equal(game.debt?.amount,500);assert.equal(game.debt?.to,'alice');now+=10000;await act(game,'pay');
  assert.equal(game.phase,'buy');assert.equal(game.traps?.length,1);assert.equal(game.traps?.[0].ownerId,'cara');
  assert.equal((await view(game,'bob',key('bob'))).players[2].money,15000);
});

test('bots pay a revealed trap and then buy the landed company without stalling',async t=>{
  let now=10000;t.mock.method(Date,'now',()=>now);const values=[0,0.17];t.mock.method(Math,'random',()=>values.shift()??0);
  const callbacks:Array<()=>Promise<void>>=[];t.mock.method(globalThis,'setTimeout',(callback:()=>Promise<void>)=>{callbacks.push(callback);return {} as ReturnType<typeof setTimeout>});
  const game=fixture();await act(game,'trapPlace',{tile:3,amount:1000});game.turn=1;game.players[1].bot=true;
  await act(game,'roll');assert.equal(game.debt?.kind,'trap');now+=10000;
  assert.equal(callbacks.length,1);await callbacks.shift()!();assert.equal(game.phase,'buy');
  assert.equal(callbacks.length,1);await callbacks.shift()!();assert.equal(game.owners[3],'bob');assert.equal(game.turn,2);
  assert.equal(callbacks.length,0);assert.equal(game.trapResult,undefined);assert.equal(game.players[0].money,15600);
});


test('a reverse move triggers a trap on the actual landed company',async t=>{
  let now=10000;t.mock.method(Date,'now',()=>now);const rolls=[0,0.2];t.mock.method(Math,'random',()=>rolls.shift()??0);
  const game=fixture();game.players[0].position=6;game.players[0].reverseNextMove=true;
  game.traps=[{id:'reverse-trap',ownerId:'bob',tile:3,amount:500,cost:200,placedAfter:{}}];
  assert.equal((await act(game,'roll')).status,200);assert.equal(game.players[0].position,3);
  assert.equal(game.move?.direction,-1);assert.equal(game.players[0].reverseNextMove,undefined);
  assert.equal(game.debt?.kind,'trap');assert.equal(game.trapResult?.tile,3);
  now+=10000;assert.equal((await act(game,'pay')).status,200);assert.equal(game.phase,'buy');
});
