import { colors, DICE_ROLL_MS, TOKEN_STEP_MS, MAX_PROPERTY_LEVEL, MORTGAGE_TURNS, JACKPOT_BET, JACKPOT_PAYOUTS, DIAMOND_FEE, LOAN_PRINCIPAL, LOAN_TOTAL_DUE, LOAN_TURNS, isDiceRent, diceRentFactor, isCarCompany, carRent, propertyRent, propertyUpgradeCost, ownsFullGroup, effectivePropertyLevel, groupHasMortgage, liquidFunds, type Game, type Player, tiles, type Trade } from '@/lib/game';
import { drawChance } from '@/lib/chance';
import { AUCTION_BID_STEP, minimumAuctionBid, maximumAuctionBid } from '@/lib/auction';
import { drawRoulette, ROULETTE_OUTCOMES, ROULETTE_SPIN_MS } from '@/lib/roulette';
import { DUEL_MIN_BET, DUEL_BET_STEP, DUEL_ROLL_MS, maxDuelBet } from '@/lib/duel';
import { TRAP_AMOUNTS, TRAP_LIFETIME_ROUNDS, TRAP_COOLDOWN_ROUNDS, trapCost, fullRoundsSince } from '@/lib/traps';

const globalStore = globalThis as typeof globalThis & { monopolyRooms?: Map<string, Game>; monopolyPrivateKeys?: Map<string, Map<string, string>> };
const rooms = globalStore.monopolyRooms ??= new Map<string, Game>();
const privateKeys = globalStore.monopolyPrivateKeys ??= new Map<string, Map<string, string>>();
const fail=(message:string,status=400)=>Response.json({error:message},{status});
const log=(g:Game,s:string)=>{g.log=[s,...g.log].slice(0,40)};
const current=(g:Game)=>g.players[g.turn];
function tradeTerms(g:Game,from:Player,to:Player,value:unknown){
 if(!value||typeof value!=='object')return;
 const {give,take,giveCash,takeCash}=value as Trade;
 const validProperties=(indices:unknown,ownerId:string):indices is number[]=>Array.isArray(indices)&&new Set(indices).size===indices.length&&indices.every(i=>Number.isInteger(i)&&!!tiles[i]?.price&&g.owners[i]===ownerId);
 if(!validProperties(give,from.id)||!validProperties(take,to.id)||!Number.isSafeInteger(giveCash)||!Number.isSafeInteger(takeCash)||giveCash<0||takeCash<0||giveCash>from.money||takeCash>to.money)return;
 const balances=[{player:from,money:from.money-giveCash+takeCash},{player:to,money:to.money-takeCash+giveCash}];
 if(balances.some(({player,money})=>!Number.isSafeInteger(money)||(g.auction?.bidder===player.id&&money<g.auction.bid)))return;
 return {give,take,giveCash,takeCash};
}
const playerKey=(req:Request)=>{const key=req.headers.get('X-Player-Key')||'';return key.length>=32&&key.length<=128?key:''};
function rememberKey(g:Game,id:string,key:string){if(!key)return;let keys=privateKeys.get(g.code);if(!keys){keys=new Map();privateKeys.set(g.code,keys)}if(!keys.has(id))keys.set(id,key)}
function gameView(g:Game,viewerId:string,key:string){
 const {traps=[],trapPlacements,completedTurns,...visible}=g;
 const privateView=!!key&&privateKeys.get(g.code)?.get(viewerId)===key;
 const mine=privateView?traps.find(trap=>trap.ownerId===viewerId):undefined;
 const clock={players:g.players,completedTurns};
 return {...visible,
  players:g.players.map(player=>({...player,money:player.money+(player.bankrupt||privateView&&player.id===viewerId?0:traps.filter(trap=>trap.ownerId===player.id).reduce((sum,trap)=>sum+trap.cost,0))})),
  ...(mine?{myTrap:{tile:mine.tile,amount:mine.amount,roundsLeft:Math.max(0,TRAP_LIFETIME_ROUNDS-fullRoundsSince(clock,mine.placedAfter))}}:{}),
  trapCooldown:trapPlacements?.[viewerId]?Math.max(0,TRAP_COOLDOWN_ROUNDS-fullRoundsSince(clock,trapPlacements[viewerId])):0,
 };
}
function advanceTraps(g:Game){
 g.traps=(g.traps||[]).filter(trap=>{
  const owner=g.players.find(player=>player.id===trap.ownerId);
  if(!owner||owner.bankrupt||fullRoundsSince(g,trap.placedAfter)>=TRAP_LIFETIME_ROUNDS){log(g,`Ловушка игрока ${owner?.name||'Игрок'} исчезает`);return false}
  return true;
 });
}
function advanceMortgages(g:Game, ownerId:string){
 g.mortgageTurns ??= {};
 for(const i of [...g.mortgaged]){
  if(g.owners[i]!==ownerId)continue;
  const remaining=(g.mortgageTurns[i]??MORTGAGE_TURNS)-1;
  if(remaining>0){g.mortgageTurns[i]=remaining;continue}
  g.mortgaged=g.mortgaged.filter(tile=>tile!==i);delete g.mortgageTurns[i];delete g.owners[i];if(g.levels)delete g.levels[i];
  if(g.trade&&(g.trade.give.includes(i)||g.trade.take.includes(i))){g.trade=undefined;log(g,`Сделка отменена: срок залога ${tiles[i].name} истёк`)}
  log(g,`${tiles[i].name} возвращается банку: срок залога истёк`);
 }
}
function beginTurn(g: Game) {
 const player = current(g);
 g.debt = undefined;
 g.auction = undefined;
 g.chanceResult = undefined;
 g.rouletteResult = undefined;
 g.trapResult = undefined;
 g.phase = player.jailed ? 'jail' : 'roll';
 if (player.loan && player.loan.turnsLeft <= 0) {
  g.debt = {amount: player.loan.totalDue, reason:'Погашение кредита', kind:'loan', afterPayment:'resumeTurn'};
  g.phase = 'pay';
  log(g, `${player.name}: наступил срок возврата кредита — ${player.loan.totalDue}k`);
 }
}
function startOrSkipTurn(g:Game){
 const player=current(g);
 if(player.skipNextTurn){player.skipNextTurn=undefined;log(g,`${player.name} пропускает ход по карточке «Шанс»`);next(g);return}
 beginTurn(g);
}
function next(g:Game){
 const player=current(g);advanceMortgages(g,player.id);if(player.loan)player.loan.turnsLeft=Math.max(0,player.loan.turnsLeft-1);const alive=g.players.filter(p=>!p.bankrupt);
 if(alive.length<=1){g.phase='finished';g.winner=alive[0]?.id;g.extraTurn=undefined;g.bonusRolls=undefined;g.debt=undefined;g.auction=undefined;g.trade=undefined;g.chanceResult=undefined;g.rouletteResult=undefined;g.traps=[];g.trapResult=undefined;return}
 const doubleTurn=g.extraTurn===player.id;
 if((doubleTurn||(g.bonusRolls||0)>0)&&!player.bankrupt&&!player.jailed){if(!doubleTurn)g.bonusRolls=(g.bonusRolls||0)-1;g.turnSerial=(g.turnSerial||1)+1;g.extraTurn=undefined;log(g,`${player.name} получает ещё один ход ${doubleTurn?'за дубль':'от рулетки'}`);startOrSkipTurn(g);return}
 g.completedTurns ??= {};g.completedTurns[player.id]=(g.completedTurns[player.id]||0)+1;advanceTraps(g);
 g.turnSerial=(g.turnSerial||1)+1;g.extraTurn=undefined;g.bonusRolls=undefined;player.doubles=0;
 do { g.turn=(g.turn+1)%g.players.length } while(current(g).bankrupt);startOrSkipTurn(g);
}
function eliminate(g:Game, player:Player, receiver:Player | undefined, reason:string) {
 if(g.trade && (g.trade.from===player.id || g.trade.to===player.id)) { g.trade=undefined; log(g,'Сделка отменена: игрок выбыл'); }
 if(g.duel && (g.duel.from===player.id || g.duel.to===player.id)) {
  if(g.phase==='duelResult') for(const participant of g.players) if(participant.id===g.duel.from || participant.id===g.duel.to) participant.money+=g.duel.bet;
  g.duel=undefined;g.phase='roll';g.animationUntil=0;log(g,'Дуэль отменена: игрок выбыл');
 }
 const creditor=receiver&&receiver.id!==player.id&&!receiver.bankrupt?receiver:undefined,amount=player.money;
 if(creditor)creditor.money+=amount;
 const properties=Object.keys(g.owners).map(Number).filter(i=>g.owners[i]===player.id);
 for(const i of properties){delete g.owners[i];delete g.levels?.[i];delete g.mortgageTurns?.[i]}
 g.mortgaged=g.mortgaged.filter(i=>!properties.includes(i));
 player.money=0;player.bankrupt=true;player.loan=undefined;
 log(g,`${player.name} ${reason}`);
 log(g,creditor?`${creditor.name} получает ${amount}k — остаток денег игрока ${player.name}`:`Остаток денег игрока ${player.name} — ${amount}k — возвращается банку`);
 if(properties.length)log(g,`Компании игрока ${player.name} возвращаются банку: ${properties.map(i=>tiles[i].name).join(', ')}`);
 advanceTraps(g);
 if(current(g).id===player.id){next(g);return}
 if(g.debt?.to===player.id)g.debt.to=undefined;
 if(g.players.filter(p=>!p.bankrupt).length<=1){g.phase='finished';g.winner=g.players.find(p=>!p.bankrupt)?.id;g.extraTurn=undefined;g.bonusRolls=undefined;g.debt=undefined;g.auction=undefined;g.trade=undefined;g.chanceResult=undefined;g.rouletteResult=undefined;g.duel=undefined;g.traps=[];g.trapResult=undefined;return}
 if(g.auction){if(g.auction.bidder===player.id){g.auction.bidder=undefined;g.auction.bid=0}if(!g.auction.passed.includes(player.id))g.auction.passed.push(player.id)}
}
function recordLanding(g:Game,tile:number){g.tileVisits ??= {};g.tileVisits[tile]=(g.tileVisits[tile]||0)+1}
function movePlayer(g:Game,p:Player,d1:number,d2:number,direction:1|-1=1){
 const steps=d1+d2, old=p.position; p.position=(old+direction*steps+40)%40;
 const landed=p.position, tile=tiles[landed];recordLanding(g,landed);
 g.move={playerId:p.id,steps,...(direction===-1?{direction}:{}),jailTransfer:landed===30};
 g.animationUntil=Date.now()+DICE_ROLL_MS+steps*TOKEN_STEP_MS+(landed===30?1800:0);
 if(direction===1&&old+steps>=40){p.lapsCompleted=(p.lapsCompleted||0)+1;const reward=landed===0?3000:2000;p.money+=reward;log(g,landed===0?`${p.name} останавливается на старте и получает 3,000k`:`${p.name} проходит круг и получает 2,000k`)}
 log(g,`${p.name} выбрасывает ${d1}:${d2}${direction===-1?' и движется назад':''} и попадает на «${tile.name}»`);
 if(landed===30){p.position=10;recordLanding(g,10);p.jailed=true;p.jailAttempts=0;log(g,`${p.name} отправляется в тюрьму`);next(g);return}
 landOnTile(g,p,steps);
}
function landOnTile(g:Game,p:Player,steps:number){
 const landed=p.position,tile=tiles[landed];
 const trap=g.traps?.find(item=>item.tile===landed&&!g.players.find(owner=>owner.id===item.ownerId)?.bankrupt&&fullRoundsSince(g,item.placedAfter)<TRAP_LIFETIME_ROUNDS);
 if(trap){
  g.traps=g.traps!.filter(item=>item.id!==trap.id);
  g.trapResult={ownerId:trap.ownerId,playerId:p.id,tile:landed,amount:trap.amount};
  g.debt={amount:trap.amount,to:trap.ownerId===p.id?undefined:trap.ownerId,reason:`Ловушка на «${tile.name}»`,kind:'trap'};g.phase='pay';
  log(g,`${p.name} попадает на ловушку игрока ${g.players.find(owner=>owner.id===trap.ownerId)?.name}: ${trap.amount}k на «${tile.name}»`);return;
 }
 resolveTile(g,p,steps);
}
function resolveTile(g:Game,p:Player,steps:number){
 const landed=p.position,tile=tiles[landed];
 const owner=g.owners[landed];
 if(tile.price&&!owner)g.phase='buy';
 else if(tile.price&&owner!==p.id&&!g.mortgaged.includes(landed)){
  const receiver=g.players.find(x=>x.id===owner);
  if(receiver&&!receiver.bankrupt){const amount=isDiceRent(landed)?diceRentFactor(g.owners,landed)*steps:isCarCompany(landed)?carRent(g.owners,landed):propertyRent(landed,effectivePropertyLevel(g.owners,g.levels,landed));g.debt={amount,to:owner,reason:`Аренда «${tile.name}»`};g.phase='pay'}else next(g);
 }else if(tile.kind==='tax'){g.debt={amount:2000,reason:'Клетка «Деньги»'};g.phase='pay'}
 else if(tile.kind==='jackpot'){g.phase=Math.random()<0.5?'jackpot':'roulette'}
 else if(tile.kind==='chance'){g.chanceResult=drawChance(g,p);g.lastChanceId=g.chanceResult.id;g.phase='chanceResult';log(g,`${p.name}: «Шанс» — ${g.chanceResult.title}`)}
 else if(tile.kind==='diamond'){g.debt={amount:DIAMOND_FEE,reason:'Налог на роскошь · Бриллиант',kind:'diamond'};g.phase='pay'}else next(g);
}
function autoPassAuction(g:Game){
 const auction=g.auction;if(g.phase!=='auction'||!auction)return;
 const minimum=minimumAuctionBid(tiles[auction.tile].price||0,auction.bid);
 for(const player of g.players){
  if(player.bankrupt||player.id===auction.bidder||auction.passed.includes(player.id))continue;
  const mortgageable=Object.keys(g.owners).map(Number).some(i=>g.owners[i]===player.id&&!g.mortgaged.includes(i)&&!!tiles[i]?.price);
  if(player.money<minimum&&!mortgageable){auction.passed.push(player.id);log(g,`${player.name} автоматически пропускает аукцион — недостаточно средств и нечего заложить`)}
 }
}
function settleAuction(g:Game){const a=g.auction!; const eligible=g.players.filter(p=>!p.bankrupt&&!a.passed.includes(p.id)); if((!a.bidder && eligible.length===0) || (a.bidder && eligible.length===1 && eligible[0]?.id===a.bidder)) {if(a.bidder){const p=g.players.find(p=>p.id===a.bidder)!;p.money-=a.bid;g.owners[a.tile]=p.id;log(g,`${p.name} выигрывает аукцион за ${a.bid}k`)}else log(g,'Аукцион завершён без ставок');next(g)}}
// Keep bot decisions on the same server as the room, so every connected player
// observes one shared decision rather than racing separate browser timers.
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleBot(g: Game, delay = 850) {
 if (!g.started || g.phase === 'finished' || botTimers.has(g.code)) return;
 const tradeBot = g.trade && g.players.find(p => p.id === g.trade!.to && p.bot && !p.bankrupt);
 const duelBot = g.phase === 'duelInvite' && g.duel && g.players.find(p => p.id === g.duel!.to && p.bot && !p.bankrupt);
 const auctionBot = g.phase === 'auction' && g.auction && g.players.find(p => p.bot && !p.bankrupt && p.id !== g.auction!.bidder && !g.auction!.passed.includes(p.id));
 if (!tradeBot && !duelBot && !auctionBot && !(g.phase !== 'auction' && current(g)?.bot)) return;
 const wait = Math.max(delay, (g.animationUntil || 0) - Date.now() + 100);
 const timer = setTimeout(async () => {
  botTimers.delete(g.code);
  const room = rooms.get(g.code);
  if (!room || !room.started || room.phase === 'finished') return;
  let bot: Player | undefined;
  let action = '';
  let extra: Record<string, unknown> = {};
  const trade = room.trade;
  if (room.phase === 'duelInvite' && room.duel && (bot = room.players.find(p => p.id === room.duel!.to && p.bot && !p.bankrupt))) {
   const challenger = room.players.find(p => p.id === room.duel!.from);
   action = 'duelRespond'; extra = {duelId:room.duel.id, accept:!!challenger && !challenger.bankrupt && maxDuelBet(challenger.money,bot.money) >= room.duel.bet};
  } else if (trade && (bot = room.players.find(p => p.id === trade.to && p.bot && !p.bankrupt))) {
   const value = (indices: number[]) => indices.reduce((sum, i) => sum + (tiles[i]?.price || 0) * (room.mortgaged.includes(i) ? 0.5 : 1), 0);
   const from=room.players.find(player=>player.id===trade.from);
   action = 'tradeResponse'; extra = { tradeId:trade.id, accept: !!from && !from.bankrupt && !!tradeTerms(room,from,bot,trade) && trade.giveCash + value(trade.give) >= trade.takeCash + value(trade.take) };
  } else if (room.phase === 'auction' && room.auction) {
   const auction = room.auction;
   bot = room.players.find(p => p.bot && !p.bankrupt && p.id !== auction.bidder && !auction.passed.includes(p.id));
   if (bot) {
    const price = tiles[auction.tile].price || 0;
    const minimum = minimumAuctionBid(price, auction.bid);
    const property = Object.keys(room.owners).map(Number).filter(i=>room.owners[i]===bot!.id&&!room.mortgaged.includes(i)).sort((a,b)=>(tiles[b].price||0)-(tiles[a].price||0))[0];
    if(bot.money<minimum && property!==undefined){action=(room.levels?.[property]||0)>0?'sellUpgrade':'mortgage';extra={tile:property}}
    else {const limit = maximumAuctionBid(Math.min(Math.floor(price * 1.2), bot.money));action = limit >= minimum ? 'bid' : 'pass';extra = {amount:minimum}}
   }
  } else if ((bot = current(room))?.bot) {
   if (room.phase === 'roll') action = 'roll';
   else if (room.phase === 'jail') action = 'jailRoll';
   else if (room.phase === 'jackpot') { action = bot.money >= JACKPOT_BET ? 'jackpotBet' : 'jackpotSkip'; extra = {numbers:[2,5]}; }
   else if (room.phase === 'jackpotResult') action = 'jackpotContinue';
   else if (room.phase === 'roulette') action = bot.money >= JACKPOT_BET ? 'rouletteSpin' : 'rouletteSkip';
   else if (room.phase === 'rouletteResult') action = 'rouletteContinue';
   else if (room.phase === 'duelResult' && room.duel) { action = 'duelContinue'; extra = {duelId:room.duel.id}; }
   else if (room.phase === 'chanceResult') action = 'chanceContinue';
   else if (room.phase === 'buy') action = bot.money >= (tiles[bot.position].price || 0) ? 'buy' : 'auction';
   else if (room.phase === 'pay' && room.debt) {
    if (bot.money >= room.debt.amount) action = 'pay';
    else if (liquidFunds(room, bot) < room.debt.amount && (bot.loanUsed || bot.loan || liquidFunds(room, bot) + LOAN_PRINCIPAL < room.debt.amount)) action = 'bankrupt';
    else if (!bot.loanUsed && !bot.loan) action = 'loanTake';
    else {
     const property = Object.keys(room.owners).map(Number).filter(i => room.owners[i] === bot!.id && !room.mortgaged.includes(i)).sort((a, b) => (tiles[b].price || 0) - (tiles[a].price || 0))[0];
     action = property === undefined ? 'bankrupt' : (room.levels?.[property]||0)>0 ? 'sellUpgrade' : 'mortgage'; extra = { tile: property };
    }
   }
  }
  if (bot && action) await POST(new Request('http://localhost/api/game', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action, id: bot.id, room: room.code, ...extra}) }));
 }, wait);
 botTimers.set(g.code, timer);
}
export async function GET(req:Request){const params=new URL(req.url).searchParams,code=params.get('room')?.toUpperCase()||'';const g=rooms.get(code);return g?Response.json(gameView(g,params.get('id')||'',playerKey(req)),{headers:{'Cache-Control':'no-store'}}):fail('Комната не найдена',404)}
export async function POST(req:Request){
 try{
 const b=await req.json(),key=playerKey(req); let g:Game|undefined=rooms.get(String(b.room||'').toUpperCase());
 if(b.action==='create'){const code=Math.random().toString(36).slice(2,8).toUpperCase();const p:Player={id:b.id,name:String(b.name||'Игрок').trim().slice(0,20)||'Игрок',color:colors[0],money:15000,position:0};g={code,players:[p],host:p.id,started:false,turn:0,phase:'lobby',owners:{},levels:{},turnSerial:1,lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[`${p.name} создаёт комнату`],revision:0};rooms.set(code,g);rememberKey(g,p.id,key);return Response.json(gameView(g,p.id,key))}
 if(!g)return fail('Комната не найдена');
 g.levels ??= {};g.turnSerial ??= 1;g.lastUpgradeTurn ??= {};g.mortgageTurns ??= {};for(const i of g.mortgaged)g.mortgageTurns[i] ??= MORTGAGE_TURNS;
 let p=g.players.find(x=>x.id===b.id);
 if(b.action==='join'){if(!p){if(g.started)return fail('Игра уже началась');if(g.players.length>=6)return fail('Комната заполнена');p={id:b.id,name:String(b.name||'Игрок').trim().slice(0,20)||'Игрок',color:colors[g.players.length],money:15000,position:0};g.players.push(p);log(g,`${p.name} присоединяется к игре`)}rememberKey(g,p.id,key);g.revision++;return Response.json(gameView(g,p.id,key))}
 if(!p)return fail('Сначала присоединитесь к комнате',403);
 if((g.phase==='duelInvite'||g.phase==='duelResult')&&!['duelRespond','duelCancel','duelContinue','surrender','chat'].includes(b.action))return fail('Сначала завершите дуэль');
 if(b.action==='leave'){if(g.started&&g.phase!=='finished')return fail('Дождитесь окончания игры');if(!g.started){g.players=g.players.filter(player=>player.id!==p!.id);const nextHost=g.players.find(player=>!player.bot);if(!nextHost){rooms.delete(g.code);privateKeys.delete(g.code);return Response.json({ok:true})}if(g.host===p.id)g.host=nextHost.id;log(g,`${p.name} покидает комнату`);g.revision++}return Response.json({ok:true})}
 if(b.action==='addBot'){if(p.id!==g.host||g.started||g.players.length>=6)return fail('Нельзя добавить бота');const used=new Set(g.players.map(x=>x.name));const name=['Бот Алекс','Бот Макс','Бот Сэм','Бот Ник','Бот Ким'].find(x=>!used.has(x)) || `Бот ${g.players.length}`;const bot:Player={id:`bot-${crypto.randomUUID()}`,name,color:colors[g.players.length],money:15000,position:0,bot:true};g.players.push(bot);log(g,`${name} присоединяется к игре`)}
 else if(b.action==='removeBot'){const index=g.players.findIndex(x=>x.id===b.botId&&x.bot);if(p.id!==g.host||g.started||index<0)return fail('Нельзя удалить бота');const [bot]=g.players.splice(index,1);g.players.forEach((player,i)=>player.color=colors[i]);log(g,`${bot.name} покидает комнату`)}
 else if(b.action==='start'){if(p.id!==g.host||g.started||g.players.length<2)return fail('Для начала нужны хотя бы два игрока');g.started=true;g.phase='roll';log(g,'Игра началась! Вперёд к новым победам')}
 else if(b.action==='trapPlace'){
  const tile=b.tile,amount=b.amount,cost=trapCost(amount),last=g.trapPlacements?.[p.id];
  if(!g.started||current(g).id!==p.id||p.bankrupt||p.jailed||g.phase!=='roll'||g.duel||g.debt||g.auction||g.trade||Date.now()<(g.animationUntil||0))return fail('Ловушку можно поставить в свой ход перед броском, после завершения сделок');
  if(!Number.isInteger(tile)||!tiles[tile]?.price||g.owners[tile]||!TRAP_AMOUNTS.some(value=>value===amount)||p.money<cost)return fail('Выберите свободную компанию, сумму ловушки и проверьте баланс');
  if(g.traps?.some(trap=>trap.ownerId===p.id)||last&&fullRoundsSince(g,last)<TRAP_COOLDOWN_ROUNDS)return fail('Следующая ловушка доступна через 10 полных кругов после предыдущей установки');
  if(!key||privateKeys.get(g.code)?.has(p.id)&&privateKeys.get(g.code)?.get(p.id)!==key)return fail('Для установки используйте устройство, на котором вы вошли в игру');
  rememberKey(g,p.id,key);
  const placedAfter=Object.fromEntries(g.players.filter(player=>!player.bankrupt).map(player=>[player.id,g!.completedTurns?.[player.id]||0]));
  g.traps ??= [];g.traps.push({id:crypto.randomUUID(),ownerId:p.id,tile,amount,cost,placedAfter});g.trapPlacements ??= {};g.trapPlacements[p.id]=placedAfter;
  p.money-=cost;log(g,`${p.name} устанавливает ловушку`);
 }
 else if(b.action==='duelChallenge'){
  const target=g.players.find(player=>player.id===b.to),bet=b.bet;
  if(!g.started||current(g).id!==p.id||p.bankrupt||p.jailed||g.phase!=='roll'||g.duel||g.debt||g.auction||g.trade||g.lastDuelTurn===g.turnSerial||Date.now()<(g.animationUntil||0))return fail('Дуэль доступна один раз за ход перед обычным броском, после завершения сделок');
  if(!target||target.id===p.id||target.bankrupt||!Number.isSafeInteger(bet)||!Number.isSafeInteger(bet*2)||bet<DUEL_MIN_BET||bet%DUEL_BET_STEP!==0||bet>maxDuelBet(p.money,target.money))return fail('Выберите соперника и ставку от 100k с шагом 100k в пределах денег обоих игроков');
  g.duel={id:crypto.randomUUID(),from:p.id,to:target.id,bet};g.lastDuelTurn=g.turnSerial;g.phase='duelInvite';
  log(g,`${p.name} вызывает игрока ${target.name} на дуэль: ставка ${bet}k с каждого`);
 }
 else if(b.action==='duelRespond'){
  const duel=g.duel;
  if(g.phase!=='duelInvite'||!duel||duel.id!==b.duelId||duel.to!==p.id||typeof b.accept!=='boolean')return fail('Вызов на дуэль недоступен');
  const challenger=g.players.find(player=>player.id===duel.from)!;
  if(b.accept){
   if(challenger.bankrupt||p.bankrupt||duel.bet>maxDuelBet(challenger.money,p.money))return fail('Недостаточно денег для принятия дуэли');
   challenger.money-=duel.bet;p.money-=duel.bet;
   const die=()=>1+Math.floor(Math.random()*6);
   duel.dice=[[die(),die()],[die(),die()]];
   const first=duel.dice[0][0]+duel.dice[0][1],second=duel.dice[1][0]+duel.dice[1][1];
   duel.winner=first>second?duel.from:second>first?duel.to:undefined;
   g.phase='duelResult';g.animationUntil=Date.now()+DUEL_ROLL_MS;
   log(g,`${p.name} принимает дуэль: банк ${duel.bet*2}k`);
  }else{g.duel=undefined;g.phase='roll';log(g,`${p.name} отклоняет вызов на дуэль`)}
 }
 else if(b.action==='duelCancel'){
  const duel=g.duel;
  if(g.phase!=='duelInvite'||!duel||duel.id!==b.duelId||duel.from!==p.id)return fail('Отмена дуэли недоступна');
  g.duel=undefined;g.phase='roll';log(g,`${p.name} отменяет вызов на дуэль`);
 }
 else if(b.action==='duelContinue'){
  const duel=g.duel;
  if(g.phase!=='duelResult'||!duel?.dice||duel.id!==b.duelId||duel.from!==p.id||current(g).id!==p.id||Date.now()<(g.animationUntil||0))return fail('Дождитесь результата дуэли');
  if(duel.winner){const winner=g.players.find(player=>player.id===duel.winner)!;winner.money+=duel.bet*2;log(g,`${winner.name} выигрывает дуэль ${duel.dice[0][0]+duel.dice[0][1]}:${duel.dice[1][0]+duel.dice[1][1]} и получает банк ${duel.bet*2}k`)}
  else{for(const player of g.players)if(player.id===duel.from||player.id===duel.to)player.money+=duel.bet;log(g,`Дуэль: ничья, ставки по ${duel.bet}k возвращены`)}
  g.duel=undefined;g.phase='roll';g.animationUntil=0;
 }
 else if(b.action==='roll'||b.action==='jailRoll') {
  const inJail=b.action==='jailRoll';if(current(g).id!==p.id||g.phase!==(inJail?'jail':'roll')||Date.now()<(g.animationUntil||0))return fail('Дождитесь своего хода и завершения движения');
  p.turnsTaken=(p.turnsTaken||0)+1;
  const direction:1|-1=p.reverseNextMove?-1:1;p.reverseNextMove=undefined;
  const d1=1+Math.floor(Math.random()*6),d2=1+Math.floor(Math.random()*6);g.dice=[d1,d2];g.rollSeq=(g.rollSeq||0)+1;g.jackpotResult=undefined;
  if(inJail&&d1!==d2){p.jailAttempts=(p.jailAttempts||0)+1;p.doubles=0;g.extraTurn=undefined;g.move=undefined;g.animationUntil=Date.now()+DICE_ROLL_MS;log(g,`${p.name} выбрасывает ${d1}:${d2} в тюрьме — дубль не выпал`);if(p.jailAttempts>=3){g.debt={amount:500,reason:'Обязательный выход из тюрьмы',afterPayment:'releaseEnd',...(direction===-1?{moveDirection:direction}:{})};g.phase='pay'}else next(g)}
  else {
   if(inJail){p.jailed=false;p.jailAttempts=0;log(g,`${p.name} выбрасывает дубль и выходит из тюрьмы`)}
   if(d1===d2){p.doubles=(p.doubles||0)+1;g.extraTurn=p.id}else{p.doubles=0;g.extraTurn=undefined}
   if((p.doubles||0)>3){const steps=(10-p.position+40)%40;p.position=10;recordLanding(g,10);p.jailed=true;p.jailAttempts=0;p.doubles=0;g.extraTurn=undefined;g.move={playerId:p.id,steps,stepMs:80};g.animationUntil=Date.now()+DICE_ROLL_MS+steps*80;log(g,`${p.name} выбрасывает ${d1}:${d2}: четвёртый дубль подряд — в тюрьму за мошенничество`);next(g)}else movePlayer(g,p,d1,d2,direction)
  }
 }
 else if(b.action==='jailPay'){if(current(g).id!==p.id||g.phase!=='jail'||!p.jailed)return fail('Выход из тюрьмы недоступен');g.debt={amount:500,reason:'Выход из тюрьмы',afterPayment:'releaseRoll'};g.phase='pay'}
 else if(b.action==='chanceContinue'){
  const card=g.chanceResult;
  if(current(g).id!==p.id||g.phase!=='chanceResult'||(card&&card.playerId!==p.id)||Date.now()<(g.animationUntil||0))return fail('Подтверждение недоступно');
  g.chanceResult=undefined;
  if(!card){log(g,`${p.name} подтверждает уже полученную награду «Шанса»`);next(g)}
  else if(card.reverseNextMove){p.reverseNextMove=true;log(g,`${p.name}: следующий ход будет в обратном направлении`);next(g)}
  else if(card.skipNextTurn){p.skipNextTurn=true;log(g,`${p.name}: следующий ход будет пропущен`);next(g)}
  else if(card.movement==='nearestAvailableCompany'){
   const old=p.position;const steps=Array.from({length:tiles.length-1},(_,i)=>i+1).find(n=>{const index=(old+n)%tiles.length;return !!tiles[index].price&&!g.owners[index]});
   if(steps===undefined){log(g,`${p.name}: свободных компаний нет`);next(g)}
   else {p.position=(old+steps)%tiles.length;recordLanding(g,p.position);g.move={playerId:p.id,steps,noDice:true};g.animationUntil=Date.now()+steps*TOKEN_STEP_MS;
    if(old+steps>=tiles.length){p.lapsCompleted=(p.lapsCompleted||0)+1;p.money+=2000;log(g,`${p.name} проходит круг и получает 2,000k`)}
    log(g,`${p.name} перемещается к свободной компании «${tiles[p.position].name}»`);landOnTile(g,p,steps)}
  }
  else if(card.amount<0){const amount=-card.amount;if(p.money>=amount){p.money-=amount;log(g,`${p.name} платит ${amount}k банку · Шанс: ${card.title}`);next(g)}else{g.debt={amount,reason:`Шанс: ${card.title}`,kind:'chance'};g.phase='pay'}}
  else {p.money+=card.amount;log(g,`${p.name} получает ${card.amount}k: ${card.title}`);next(g)}
 }
 else if(b.action==='loanTake'){
  if(!g.started||g.phase==='finished'||p.bankrupt||current(g).id!==p.id||g.phase==='auction'||Date.now()<(g.animationUntil||0))return fail('Кредит доступен только в свой ход после завершения движения');
  if(p.loan||p.loanUsed)return fail('Кредит можно взять только один раз за игру');
  p.loan={principal:LOAN_PRINCIPAL,totalDue:LOAN_TOTAL_DUE,turnsLeft:LOAN_TURNS};p.loanUsed=true;p.money+=LOAN_PRINCIPAL;
  log(g,`${p.name} берёт кредит ${LOAN_PRINCIPAL}k: вернуть ${LOAN_TOTAL_DUE}k через ${LOAN_TURNS} своих ходов`);
 }
 else if(b.action==='loanRepay'){
  if(!g.started||g.phase==='finished'||p.bankrupt||current(g).id!==p.id||g.phase==='pay'||g.phase==='auction'||Date.now()<(g.animationUntil||0)||!p.loan)return fail('Досрочное погашение сейчас недоступно');
  if(p.money<p.loan.totalDue)return fail('Недостаточно денег для погашения кредита');
  const amount=p.loan.totalDue;p.money-=amount;p.loan=undefined;log(g,`${p.name} досрочно погашает кредит: ${amount}k`);
 }
 else if(b.action==='jackpotSkip'){if(current(g).id!==p.id||g.phase!=='jackpot')return fail('Джекпот недоступен');log(g,`${p.name} пропускает джекпот`);next(g)}
 else if(b.action==='jackpotBet'){const numbers=b.numbers;if(current(g).id!==p.id||g.phase!=='jackpot'||!Array.isArray(numbers)||numbers.length<1||numbers.length>3||new Set(numbers).size!==numbers.length||numbers.some((n:unknown)=>!Number.isInteger(n)||Number(n)<1||Number(n)>6)||p.money<JACKPOT_BET)return fail('Выберите от одного до трёх чисел и проверьте баланс');p.money-=JACKPOT_BET;const result=1+Math.floor(Math.random()*6),payout=numbers.includes(result)?JACKPOT_PAYOUTS[numbers.length]:0;p.money+=payout;g.jackpotResult={playerId:p.id,choice:numbers,result,payout};g.phase='jackpotResult';g.animationUntil=Date.now()+1100}
 else if(b.action==='jackpotContinue'){if(current(g).id!==p.id||g.phase!=='jackpotResult'||Date.now()<(g.animationUntil||0)||!g.jackpotResult)return fail('Дождитесь результата джекпота');const result=g.jackpotResult;log(g,`${p.name}: джекпот — выпало ${result.result}, ${result.payout?`выплата ${result.payout}k`:'ставка проиграна'}`);next(g)}
 else if(b.action==='rouletteSkip'){
  if(current(g).id!==p.id||g.phase!=='roulette'||Date.now()<(g.animationUntil||0))return fail('Рулетка недоступна');
  log(g,`${p.name} пропускает рулетку`);next(g);
 }
 else if(b.action==='rouletteSpin'){
  if(current(g).id!==p.id||g.phase!=='roulette'||Date.now()<(g.animationUntil||0)||p.money<JACKPOT_BET)return fail('Дождитесь своего хода и проверьте баланс для ставки 1 000k');
  const outcome=drawRoulette();p.money+=outcome.payout-JACKPOT_BET;
  g.rouletteResult={playerId:p.id,outcome:outcome.id,stopPosition:0.1+Math.random()*0.8};g.phase='rouletteResult';g.animationUntil=Date.now()+ROULETTE_SPIN_MS;
 }
 else if(b.action==='rouletteContinue'){
  const result=g.rouletteResult,outcome=ROULETTE_OUTCOMES.find(item=>item.id===result?.outcome);
  if(current(g).id!==p.id||g.phase!=='rouletteResult'||result?.playerId!==p.id||!outcome||Date.now()<(g.animationUntil||0))return fail('Дождитесь результата рулетки');
  log(g,`${p.name}: рулетка — ${outcome.title}, ${outcome.payout?`выплата ${outcome.payout}k`:'ставка проиграна'}`);
  if(outcome.id==='extraRoll')g.bonusRolls=(g.bonusRolls||0)+1;
  if(outcome.id==='start'||outcome.id==='jail'){
   const destination=outcome.id==='start'?0:10,steps=(destination-p.position+40)%40;
   g.move={playerId:p.id,steps,stepMs:80};p.position=destination;recordLanding(g,destination);g.animationUntil=Date.now()+steps*80;
   if(outcome.id==='jail'){p.jailed=true;p.jailAttempts=0;p.doubles=0;g.extraTurn=undefined}
  }
  next(g);
 }
 else if(b.action==='buy'){if(current(g).id!==p.id||g.phase!=='buy')return fail('Покупка недоступна');const t=tiles[p.position];if(!t.price||p.money<t.price)return fail('Недостаточно денег');p.money-=t.price;g.owners[p.position]=p.id;log(g,`${p.name} покупает ${t.name} за ${t.price}k`);next(g)}
 else if(b.action==='auction'){if(current(g).id!==p.id||g.phase!=='buy')return fail('Аукцион недоступен');g.auction={tile:p.position,bid:0,passed:[p.id],seller:p.id};g.phase='auction';log(g,`Начинается аукцион: ${tiles[p.position].name}`);settleAuction(g)}
 else if(b.action==='bid'){const a=g.auction;const amount=Number(b.amount);if(g.phase!=='auction'||!a||p.bankrupt||a.passed.includes(p.id)||!Number.isSafeInteger(amount)||amount%AUCTION_BID_STEP!==0||amount<minimumAuctionBid(tiles[a.tile].price||0,a.bid)||amount>p.money)return fail('Ставка должна быть кратна 100k, не ниже стоимости компании и минимум на 100k выше текущей');a.bid=amount;a.bidder=p.id;log(g,`${p.name} предлагает ${amount}k`);settleAuction(g)}
 else if(b.action==='pass'){const a=g.auction;if(g.phase!=='auction'||!a||p.bankrupt||a.passed.includes(p.id)||a.bidder===p.id)return fail('Сейчас нельзя отказаться');a.passed.push(p.id);settleAuction(g)}
 else if(b.action==='pay'){
  if(current(g).id!==p.id||g.phase!=='pay'||!g.debt||Date.now()<(g.animationUntil||0))return fail('Платёж недоступен');
  if(p.money<g.debt.amount)return fail('Недостаточно денег. Возьмите кредит или выберите имущество для залога');
  const debt=g.debt;p.money-=debt.amount;const receiver=g.players.find(x=>x.id===debt.to);if(receiver)receiver.money+=debt.amount;
  log(g,`${p.name} платит ${debt.amount}k${receiver?' игроку '+receiver.name:' банку'} · ${debt.reason}`);
  if(debt.kind==='trap'){g.debt=undefined;g.trapResult=undefined;resolveTile(g,p,(g.dice[0]||0)+(g.dice[1]||0))}
  else if(debt.kind==='loan'){p.loan=undefined;g.debt=undefined;g.phase=p.jailed?'jail':'roll'}
  else if(debt.afterPayment==='releaseRoll'||debt.afterPayment==='releaseEnd'){
   p.jailed=false;p.jailAttempts=0;log(g,`${p.name} выходит из тюрьмы`);g.debt=undefined;
   if(debt.afterPayment==='releaseRoll')g.phase='roll';else movePlayer(g,p,g.dice[0],g.dice[1],debt.moveDirection);
  }else next(g);
 }
 else if(b.action==='upgrade'){const i=Number(b.tile),tile=tiles[i],level=g.levels[i]||0,cost=tile?.price?propertyUpgradeCost(i,level):0;const groupKey=tile?.group||'';if(!g.started||g.phase==='finished'||p.bankrupt||g.owners[i]!==p.id||!tile?.price||isDiceRent(i)||isCarCompany(i)||g.mortgaged.includes(i)||level>=MAX_PROPERTY_LEVEL)return fail('Улучшение недоступно');if(current(g).id!==p.id)return fail('Улучшать компании можно только в свой ход');if(!ownsFullGroup(g.owners,i))return fail('Для улучшения выкупите всю улицу');if(groupHasMortgage(g.mortgaged,i))return fail('Сначала выкупите из залога все компании этой улицы');if(g.lastUpgradeTurn[groupKey]===g.turnSerial)return fail('Эту улицу уже улучшали в текущем ходу');if(g.phase==='pay'&&current(g).id===p.id)return fail('Сначала погасите задолженность');if(p.money<cost||(g.auction?.bidder===p.id&&p.money-cost<g.auction.bid))return fail('Недостаточно свободных средств для улучшения');p.money-=cost;g.levels[i]=level+1;g.lastUpgradeTurn[groupKey]=g.turnSerial;log(g,`${p.name} улучшает ${tile.name} до уровня ${level+2}`)}
 else if(b.action==='sellUpgrade'){const i=Number(b.tile),tile=tiles[i],level=g.levels[i]||0;if(!g.started||g.phase==='finished'||p.bankrupt||g.owners[i]!==p.id||!tile?.price||g.mortgaged.includes(i)||level<1)return fail('Нельзя продать улучшение');const amount=Math.floor(propertyUpgradeCost(i,level-1)/2);g.levels[i]=level-1;p.money+=amount;log(g,`${p.name} продаёт улучшение ${tile.name} за ${amount}k`)}
 else if(b.action==='mortgage'){const i=Number(b.tile);if(g.owners[i]!==p.id||g.mortgaged.includes(i)||!tiles[i]?.price||(g.levels[i]||0)>0)return fail('Сначала продайте улучшения этой компании');g.mortgaged.push(i);g.mortgageTurns[i]=MORTGAGE_TURNS;p.money+=Math.floor(tiles[i].price!/2);log(g,`${p.name} закладывает ${tiles[i].name}`)}
 else if(b.action==='unmortgage'){const i=Number(b.tile);const amount=Math.ceil((tiles[i]?.price||0)*.55);if(g.owners[i]!==p.id||!g.mortgaged.includes(i)||p.money<amount)return fail('Не удалось выкупить компанию');g.mortgaged=g.mortgaged.filter(x=>x!==i);delete g.mortgageTurns[i];p.money-=amount;log(g,`${p.name} выкупает ${tiles[i].name} из залога`)}
 else if(b.action==='bankrupt'){if(current(g).id!==p.id||g.phase!=='pay'||!g.debt||liquidFunds(g,p)>=g.debt.amount)return fail('Доступных средств достаточно для погашения долга');eliminate(g,p,g.players.find(x=>x.id===g!.debt?.to),'объявляет банкротство')}
 else if(b.action==='surrender'){if(!g.started||g.phase==='finished'||p.bankrupt)return fail('Сдаться сейчас нельзя');const receiver=current(g).id===p.id?g.players.find(x=>x.id===g!.debt?.to):undefined;eliminate(g,p,receiver,'сдаётся')}
 else if(b.action==='trade'||b.action==='tradeCounter'){
  const counter=b.action==='tradeCounter',previous=g.trade,t=b.trade as Trade|undefined,target=g.players.find(x=>x.id===t?.to);
  if(!g.started||g.phase==='finished'||p.bankrupt||!target||target.id===p.id||target.bankrupt)return fail('Сделка недоступна');
  if(counter){if(!previous?.id||b.tradeId!==previous.id||previous.to!==p.id||target.id!==previous.from)return fail('Предложение изменилось или уже закрыто')}
  else if(previous)return fail('Сначала завершите текущую сделку');
  const terms=tradeTerms(g,p,target,t);if(!terms)return fail('Проверьте условия сделки');
  g.trade={id:crypto.randomUUID(),...(counter?{counterOf:previous!.id}:{}),from:p.id,to:target.id,...terms};
  log(g,counter?`${p.name} отправляет встречное предложение игроку ${target.name}`:`${p.name} предлагает сделку игроку ${target.name}`);
 }
 else if(b.action==='tradeResponse'){
  const t=g.trade,from=g.players.find(x=>x.id===t?.from);
  if(!g.started||g.phase==='finished'||p.bankrupt||!from||from.bankrupt||!t?.id||b.tradeId!==t.id||t.to!==p.id||typeof b.accept!=='boolean')return fail('Предложение изменилось или уже закрыто');
  if(b.accept){
   if(!tradeTerms(g,from,p,t))return fail('Условия сделки изменились');
   from.money+=t.takeCash-t.giveCash;p.money+=t.giveCash-t.takeCash;
   t.give.forEach(i=>g!.owners[i]=p!.id);t.take.forEach(i=>g!.owners[i]=from.id);
   log(g,`${p.name} принимает сделку с ${from.name}`);
  }else log(g,`${p.name} отклоняет сделку`);
  g.trade=undefined;
 }
 else if(b.action==='cancelTrade'){
  const t=g.trade;if(!g.started||g.phase==='finished'||p.bankrupt||!t?.id||b.tradeId!==t.id||t.from!==p.id)return fail('Предложение изменилось или уже закрыто');
  g.trade=undefined;log(g,`${p.name} отменяет предложение о сделке`);
 }
 else if(b.action==='chat'){const message=String(b.message||'').trim().slice(0,160);if(message)log(g,`${p.name}: ${message}`)}
 else return fail('Неизвестное действие');if(g.phase==='auction'&&g.auction){autoPassAuction(g);settleAuction(g)}g.revision++;scheduleBot(g,b.action==='jackpotBet'?2400:850);return Response.json(gameView(g,p.id,key));
 }catch{return fail('Не удалось выполнить действие')}
}
