import { colors, DICE_ROLL_MS, TOKEN_STEP_MS, MAX_PROPERTY_LEVEL, MORTGAGE_TURNS, JACKPOT_BET, JACKPOT_PAYOUTS, DIAMOND_FEE, LOAN_PRINCIPAL, LOAN_TOTAL_DUE, LOAN_TURNS, isDiceRent, diceRentFactor, isCarCompany, carRent, propertyRent, propertyUpgradeCost, ownsFullGroup, effectivePropertyLevel, groupHasMortgage, type Game, type Player, tiles, type Trade } from '@/lib/game';
import { drawChance } from '@/lib/chance';

const globalStore = globalThis as typeof globalThis & { monopolyRooms?: Map<string, Game> };
const rooms = globalStore.monopolyRooms ??= new Map<string, Game>();
const fail=(message:string,status=400)=>Response.json({error:message},{status});
const log=(g:Game,s:string)=>{g.log=[s,...g.log].slice(0,40)};
const current=(g:Game)=>g.players[g.turn];
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
 g.phase = player.jailed ? 'jail' : 'roll';
 if (player.loan && player.loan.turnsLeft <= 0) {
  g.debt = {amount: player.loan.totalDue, reason:'Погашение кредита', kind:'loan', afterPayment:'resumeTurn'};
  g.phase = 'pay';
  log(g, `${player.name}: наступил срок возврата кредита — ${player.loan.totalDue}k`);
 }
}
function next(g:Game){
 const player=current(g);advanceMortgages(g,player.id);if(player.loan)player.loan.turnsLeft=Math.max(0,player.loan.turnsLeft-1);const alive=g.players.filter(p=>!p.bankrupt);
 if(alive.length<=1){g.phase='finished';g.winner=alive[0]?.id;g.extraTurn=undefined;g.debt=undefined;g.auction=undefined;g.chanceResult=undefined;return}
 if(g.extraTurn===player.id&&!player.bankrupt&&!player.jailed){g.turnSerial=(g.turnSerial||1)+1;g.extraTurn=undefined;beginTurn(g);log(g,`${player.name} получает ещё один ход за дубль`);return}
 g.turnSerial=(g.turnSerial||1)+1;g.extraTurn=undefined;player.doubles=0;
 do { g.turn=(g.turn+1)%g.players.length } while(current(g).bankrupt);beginTurn(g);
}
function movePlayer(g:Game,p:Player,d1:number,d2:number){
 const steps=d1+d2, old=p.position; p.position=(old+steps)%40;
 const landed=p.position, tile=tiles[landed];
 g.move={playerId:p.id,steps,jailTransfer:landed===30};
 g.animationUntil=Date.now()+DICE_ROLL_MS+steps*TOKEN_STEP_MS+(landed===30?1800:0);
 if(old+steps>=40){const reward=landed===0?3000:2000;p.money+=reward;log(g,landed===0?`${p.name} останавливается на старте и получает 3,000k`:`${p.name} проходит круг и получает 2,000k`)}
 log(g,`${p.name} выбрасывает ${d1}:${d2} и попадает на «${tile.name}»`);
 if(landed===30){p.position=10;p.jailed=true;p.jailAttempts=0;log(g,`${p.name} отправляется в тюрьму`);next(g);return}
 const owner=g.owners[landed];
 if(tile.price&&!owner)g.phase='buy';
 else if(tile.price&&owner!==p.id&&!g.mortgaged.includes(landed)){
  const receiver=g.players.find(x=>x.id===owner);
  if(receiver&&!receiver.bankrupt){const amount=isDiceRent(landed)?diceRentFactor(g.owners,landed)*steps:isCarCompany(landed)?carRent(g.owners,landed):propertyRent(landed,effectivePropertyLevel(g.owners,g.levels,landed));g.debt={amount,to:owner,reason:`Аренда «${tile.name}»`};g.phase='pay'}else next(g);
 }else if(tile.kind==='tax'){g.debt={amount:2000,reason:'Клетка «Деньги»'};g.phase='pay'}
 else if(tile.kind==='jackpot'){g.phase='jackpot'}
 else if(tile.kind==='chance'){g.chanceResult=drawChance(g,p);g.lastChanceId=g.chanceResult.id;g.phase='chanceResult';log(g,`${p.name}: «Шанс» — ${g.chanceResult.title}`)}
 else if(tile.kind==='diamond'){g.debt={amount:DIAMOND_FEE,reason:'Налог на роскошь · Бриллиант',kind:'diamond'};g.phase='pay'}else next(g);
}
function autoPassAuction(g:Game){
 const auction=g.auction;if(g.phase!=='auction'||!auction)return;
 const minimum=Math.ceil(Math.max(tiles[auction.tile].price||0,auction.bid+1)/2)*2;
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
 const auctionBot = g.phase === 'auction' && g.auction && g.players.find(p => p.bot && !p.bankrupt && p.id !== g.auction!.bidder && !g.auction!.passed.includes(p.id));
 if (!tradeBot && !auctionBot && !(g.phase !== 'auction' && current(g)?.bot)) return;
 const wait = Math.max(delay, (g.animationUntil || 0) - Date.now() + 100);
 const timer = setTimeout(async () => {
  botTimers.delete(g.code);
  const room = rooms.get(g.code);
  if (!room || !room.started || room.phase === 'finished') return;
  let bot: Player | undefined;
  let action = '';
  let extra: Record<string, unknown> = {};
  const trade = room.trade;
  if (trade && (bot = room.players.find(p => p.id === trade.to && p.bot && !p.bankrupt))) {
   const value = (indices: number[]) => indices.reduce((sum, i) => sum + (tiles[i]?.price || 0) * (room.mortgaged.includes(i) ? 0.5 : 1), 0);
   action = 'tradeResponse'; extra = { accept: trade.giveCash + value(trade.give) >= trade.takeCash + value(trade.take) && trade.takeCash <= bot.money };
  } else if (room.phase === 'auction' && room.auction) {
   const auction = room.auction;
   bot = room.players.find(p => p.bot && !p.bankrupt && p.id !== auction.bidder && !auction.passed.includes(p.id));
   if (bot) {
    const price = tiles[auction.tile].price || 0;
    const minimum = Math.ceil(Math.max(price, auction.bid + 1)/2)*2;
    const amount = Math.max(price, auction.bid + 100);
    const property = Object.keys(room.owners).map(Number).filter(i=>room.owners[i]===bot!.id&&!room.mortgaged.includes(i)).sort((a,b)=>(tiles[b].price||0)-(tiles[a].price||0))[0];
    if(bot.money<minimum && property!==undefined){action=(room.levels?.[property]||0)>0?'sellUpgrade':'mortgage';extra={tile:property}}
    else {const limit = Math.min(Math.floor(price * 1.2), bot.money);const offer=Math.min(amount,Math.floor(limit/2)*2);action = offer >= minimum ? 'bid' : 'pass';extra = {amount:offer}}
   }
  } else if ((bot = current(room))?.bot) {
   if (room.phase === 'roll') action = 'roll';
   else if (room.phase === 'jail') action = 'jailRoll';
   else if (room.phase === 'jackpot') { action = bot.money >= JACKPOT_BET ? 'jackpotBet' : 'jackpotSkip'; extra = {numbers:[2,5]}; }
   else if (room.phase === 'jackpotResult') action = 'jackpotContinue';
   else if (room.phase === 'chanceResult') action = 'chanceContinue';
   else if (room.phase === 'buy') action = bot.money >= (tiles[bot.position].price || 0) ? 'buy' : 'auction';
   else if (room.phase === 'pay' && room.debt) {
    if (bot.money >= room.debt.amount) action = 'pay';
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
export async function GET(req:Request){const code=new URL(req.url).searchParams.get('room')?.toUpperCase()||'';const g=rooms.get(code);return g?Response.json(g,{headers:{'Cache-Control':'no-store'}}):fail('Комната не найдена',404)}
export async function POST(req:Request){
 try{
 const b=await req.json(); let g:Game|undefined=rooms.get(String(b.room||'').toUpperCase());
 if(b.action==='create'){const code=Math.random().toString(36).slice(2,8).toUpperCase();const p:Player={id:b.id,name:String(b.name||'Игрок').trim().slice(0,20)||'Игрок',color:colors[0],money:15000,position:0};g={code,players:[p],host:p.id,started:false,turn:0,phase:'lobby',owners:{},levels:{},turnSerial:1,lastUpgradeTurn:{},mortgaged:[],mortgageTurns:{},dice:[],log:[`${p.name} создаёт комнату`],revision:0};rooms.set(code,g);return Response.json(g)}
 if(!g)return fail('Комната не найдена');
 g.levels ??= {};g.turnSerial ??= 1;g.lastUpgradeTurn ??= {};g.mortgageTurns ??= {};for(const i of g.mortgaged)g.mortgageTurns[i] ??= MORTGAGE_TURNS;
 let p=g.players.find(x=>x.id===b.id);
 if(b.action==='join'){if(!p){if(g.started)return fail('Игра уже началась');if(g.players.length>=6)return fail('Комната заполнена');p={id:b.id,name:String(b.name||'Игрок').trim().slice(0,20)||'Игрок',color:colors[g.players.length],money:15000,position:0};g.players.push(p);log(g,`${p.name} присоединяется к игре`)}g.revision++;return Response.json(g)}
 if(!p)return fail('Сначала присоединитесь к комнате',403);
 if(b.action==='leave'){if(g.started&&g.phase!=='finished')return fail('Дождитесь окончания игры');if(!g.started){g.players=g.players.filter(player=>player.id!==p!.id);const nextHost=g.players.find(player=>!player.bot);if(!nextHost){rooms.delete(g.code);return Response.json({ok:true})}if(g.host===p.id)g.host=nextHost.id;log(g,`${p.name} покидает комнату`);g.revision++}return Response.json({ok:true})}
 if(b.action==='addBot'){if(p.id!==g.host||g.started||g.players.length>=6)return fail('Нельзя добавить бота');const used=new Set(g.players.map(x=>x.name));const name=['Бот Алекс','Бот Макс','Бот Сэм','Бот Ник','Бот Ким'].find(x=>!used.has(x)) || `Бот ${g.players.length}`;const bot:Player={id:`bot-${crypto.randomUUID()}`,name,color:colors[g.players.length],money:15000,position:0,bot:true};g.players.push(bot);log(g,`${name} присоединяется к игре`)}
 else if(b.action==='removeBot'){const index=g.players.findIndex(x=>x.id===b.botId&&x.bot);if(p.id!==g.host||g.started||index<0)return fail('Нельзя удалить бота');const [bot]=g.players.splice(index,1);g.players.forEach((player,i)=>player.color=colors[i]);log(g,`${bot.name} покидает комнату`)}
 else if(b.action==='start'){if(p.id!==g.host||g.started||g.players.length<2)return fail('Для начала нужны хотя бы два игрока');g.started=true;g.phase='roll';log(g,'Игра началась! Вперёд к новым победам')}
 else if(b.action==='roll'||b.action==='jailRoll') {
  const inJail=b.action==='jailRoll';if(current(g).id!==p.id||g.phase!==(inJail?'jail':'roll')||Date.now()<(g.animationUntil||0))return fail('Дождитесь своего хода и завершения движения');
  const d1=1+Math.floor(Math.random()*6),d2=1+Math.floor(Math.random()*6);g.dice=[d1,d2];g.rollSeq=(g.rollSeq||0)+1;g.jackpotResult=undefined;
  if(inJail&&d1!==d2){p.jailAttempts=(p.jailAttempts||0)+1;p.doubles=0;g.extraTurn=undefined;g.move=undefined;g.animationUntil=Date.now()+DICE_ROLL_MS;log(g,`${p.name} выбрасывает ${d1}:${d2} в тюрьме — дубль не выпал`);if(p.jailAttempts>=3){g.debt={amount:500,reason:'Обязательный выход из тюрьмы',afterPayment:'releaseEnd'};g.phase='pay'}else next(g)}
  else {
   if(inJail){p.jailed=false;p.jailAttempts=0;log(g,`${p.name} выбрасывает дубль и выходит из тюрьмы`)}
   if(d1===d2){p.doubles=(p.doubles||0)+1;g.extraTurn=p.id}else{p.doubles=0;g.extraTurn=undefined}
   if((p.doubles||0)>3){const steps=(10-p.position+40)%40;p.position=10;p.jailed=true;p.jailAttempts=0;p.doubles=0;g.extraTurn=undefined;g.move={playerId:p.id,steps,stepMs:80};g.animationUntil=Date.now()+DICE_ROLL_MS+steps*80;log(g,`${p.name} выбрасывает ${d1}:${d2}: четвёртый дубль подряд — в тюрьму за мошенничество`);next(g)}else movePlayer(g,p,d1,d2)
  }
 }
 else if(b.action==='jailPay'){if(current(g).id!==p.id||g.phase!=='jail'||!p.jailed)return fail('Выход из тюрьмы недоступен');g.debt={amount:500,reason:'Выход из тюрьмы',afterPayment:'releaseRoll'};g.phase='pay'}
 else if(b.action==='chanceContinue'){
  const card=g.chanceResult;
  if(current(g).id!==p.id||g.phase!=='chanceResult'||(card&&card.playerId!==p.id)||Date.now()<(g.animationUntil||0))return fail('Подтверждение недоступно');
  g.chanceResult=undefined;
  if(!card){log(g,`${p.name} подтверждает уже полученную награду «Шанса»`);next(g)}
  else if(card.amount<0){g.debt={amount:-card.amount,reason:`Шанс: ${card.title}`,kind:'chance'};g.phase='pay'}
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
 else if(b.action==='buy'){if(current(g).id!==p.id||g.phase!=='buy')return fail('Покупка недоступна');const t=tiles[p.position];if(!t.price||p.money<t.price)return fail('Недостаточно денег');p.money-=t.price;g.owners[p.position]=p.id;log(g,`${p.name} покупает ${t.name} за ${t.price}k`);next(g)}
 else if(b.action==='auction'){if(current(g).id!==p.id||g.phase!=='buy')return fail('Аукцион недоступен');g.auction={tile:p.position,bid:0,passed:[p.id],seller:p.id};g.phase='auction';log(g,`Начинается аукцион: ${tiles[p.position].name}`);settleAuction(g)}
 else if(b.action==='bid'){const a=g.auction;const amount=Number(b.amount);if(g.phase!=='auction'||!a||p.bankrupt||a.passed.includes(p.id)||!Number.isSafeInteger(amount)||amount%2!==0||amount<(tiles[a.tile].price||0)||amount<=a.bid||amount>p.money)return fail('Ставка должна быть чётной, не ниже стоимости компании и выше текущей ставки');a.bid=amount;a.bidder=p.id;log(g,`${p.name} предлагает ${amount}k`);settleAuction(g)}
 else if(b.action==='pass'){const a=g.auction;if(g.phase!=='auction'||!a||p.bankrupt||a.passed.includes(p.id)||a.bidder===p.id)return fail('Сейчас нельзя отказаться');a.passed.push(p.id);settleAuction(g)}
 else if(b.action==='pay'){
  if(current(g).id!==p.id||g.phase!=='pay'||!g.debt||Date.now()<(g.animationUntil||0))return fail('Платёж недоступен');
  if(p.money<g.debt.amount)return fail('Недостаточно денег. Возьмите кредит или выберите имущество для залога');
  const debt=g.debt;p.money-=debt.amount;const receiver=g.players.find(x=>x.id===debt.to);if(receiver)receiver.money+=debt.amount;
  log(g,`${p.name} платит ${debt.amount}k${receiver?' игроку '+receiver.name:' банку'} · ${debt.reason}`);
  if(debt.kind==='loan'){p.loan=undefined;g.debt=undefined;g.phase=p.jailed?'jail':'roll'}
  else if(debt.afterPayment==='releaseRoll'||debt.afterPayment==='releaseEnd'){
   p.jailed=false;p.jailAttempts=0;log(g,`${p.name} выходит из тюрьмы`);g.debt=undefined;
   if(debt.afterPayment==='releaseRoll')g.phase='roll';else movePlayer(g,p,g.dice[0],g.dice[1]);
  }else next(g);
 }
 else if(b.action==='upgrade'){const i=Number(b.tile),tile=tiles[i],level=g.levels[i]||0,cost=tile?.price?propertyUpgradeCost(i,level):0;const groupKey=tile?.group||'';if(!g.started||g.phase==='finished'||p.bankrupt||g.owners[i]!==p.id||!tile?.price||isDiceRent(i)||isCarCompany(i)||g.mortgaged.includes(i)||level>=MAX_PROPERTY_LEVEL)return fail('Улучшение недоступно');if(!ownsFullGroup(g.owners,i))return fail('Для улучшения выкупите всю улицу');if(groupHasMortgage(g.mortgaged,i))return fail('Сначала выкупите из залога все компании этой улицы');if(g.lastUpgradeTurn[groupKey]===g.turnSerial)return fail('Эту улицу уже улучшали в текущем ходу');if(g.phase==='pay'&&current(g).id===p.id)return fail('Сначала погасите задолженность');if(p.money<cost||(g.auction?.bidder===p.id&&p.money-cost<g.auction.bid))return fail('Недостаточно свободных средств для улучшения');p.money-=cost;g.levels[i]=level+1;g.lastUpgradeTurn[groupKey]=g.turnSerial;log(g,`${p.name} улучшает ${tile.name} до уровня ${level+2}`)}
 else if(b.action==='sellUpgrade'){const i=Number(b.tile),tile=tiles[i],level=g.levels[i]||0;if(!g.started||g.phase==='finished'||p.bankrupt||g.owners[i]!==p.id||!tile?.price||g.mortgaged.includes(i)||level<1)return fail('Нельзя продать улучшение');const amount=Math.floor(propertyUpgradeCost(i,level-1)/2);g.levels[i]=level-1;p.money+=amount;log(g,`${p.name} продаёт улучшение ${tile.name} за ${amount}k`)}
 else if(b.action==='mortgage'){const i=Number(b.tile);if(g.owners[i]!==p.id||g.mortgaged.includes(i)||!tiles[i]?.price||(g.levels[i]||0)>0)return fail('Сначала продайте улучшения этой компании');g.mortgaged.push(i);g.mortgageTurns[i]=MORTGAGE_TURNS;p.money+=Math.floor(tiles[i].price!/2);log(g,`${p.name} закладывает ${tiles[i].name}`)}
 else if(b.action==='unmortgage'){const i=Number(b.tile);const amount=Math.ceil((tiles[i]?.price||0)*.55);if(g.owners[i]!==p.id||!g.mortgaged.includes(i)||p.money<amount)return fail('Не удалось выкупить компанию');g.mortgaged=g.mortgaged.filter(x=>x!==i);delete g.mortgageTurns[i];p.money-=amount;log(g,`${p.name} выкупает ${tiles[i].name} из залога`)}
 else if(b.action==='bankrupt'){if(current(g).id!==p.id||g.phase!=='pay'||!g.debt||p.money>=g.debt.amount||Object.keys(g.owners).some(i=>g!.owners[Number(i)]===p!.id&&!g!.mortgaged.includes(Number(i))))return fail('Сначала заложите доступное имущество');const receiver=g.players.find(x=>x.id===g!.debt?.to);if(receiver)receiver.money+=p.money;for(const key of Object.keys(g.owners)){const i=Number(key);if(g.owners[i]===p.id){if(receiver)g.owners[i]=receiver.id;else{delete g.owners[i];delete g.levels[i];delete g.mortgageTurns[i];g.mortgaged=g.mortgaged.filter(x=>x!==i)}}}p.money=0;p.bankrupt=true;p.loan=undefined;log(g,`${p.name} объявляет банкротство`);next(g)}
 else if(b.action==='trade'){const t=b.trade as Trade;const target=g.players.find(x=>x.id===t?.to);if(!g.started||p.bankrupt||!target||target.id===p.id||target.bankrupt||g.trade)return fail('Сделка недоступна');const give=Array.isArray(t.give)?t.give:[],take=Array.isArray(t.take)?t.take:[];const gc=Number(t.giveCash),tc=Number(t.takeCash);if(!Number.isSafeInteger(gc)||!Number.isSafeInteger(tc)||gc<0||tc<0||gc>p.money||tc>target.money||give.some(i=>g!.owners[i]!==p!.id)||take.some(i=>g!.owners[i]!==target.id)||new Set(give).size!==give.length||new Set(take).size!==take.length)return fail('Проверьте условия сделки');g.trade={id:crypto.randomUUID(),from:p.id,to:target.id,give,take,giveCash:gc,takeCash:tc};log(g,`${p.name} предлагает сделку игроку ${target.name}`)}
 else if(b.action==='tradeResponse'){const t=g.trade;if(!t||t.to!==p.id)return fail('Предложение недоступно');const from=g.players.find(x=>x.id===t.from)!;if(b.accept){if(from.bankrupt||p.bankrupt||from.money<t.giveCash||p.money<t.takeCash||t.give.some(i=>g!.owners[i]!==from.id)||t.take.some(i=>g!.owners[i]!==p!.id))return fail('Условия сделки изменились');from.money+=t.takeCash-t.giveCash;p.money+=t.giveCash-t.takeCash;t.give.forEach(i=>g!.owners[i]=p!.id);t.take.forEach(i=>g!.owners[i]=from.id);log(g,`${p.name} принимает сделку с ${from.name}`)}else log(g,`${p.name} отклоняет сделку`);g.trade=undefined}
 else if(b.action==='cancelTrade'){if(g.trade?.from!==p.id)return fail('Сделка недоступна');g.trade=undefined}
 else if(b.action==='chat'){const message=String(b.message||'').trim().slice(0,160);if(message)log(g,`${p.name}: ${message}`)}
 else return fail('Неизвестное действие');if(g.phase==='auction'&&g.auction){autoPassAuction(g);settleAuction(g)}g.revision++;scheduleBot(g,b.action==='jackpotBet'?2400:850);return Response.json(g);
 }catch{return fail('Не удалось выполнить действие')}
}
