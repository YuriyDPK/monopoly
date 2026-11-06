import type { ReactNode } from 'react';
import { money, tiles, type Game, type Trade } from '@/lib/game';

type PropertyRenderer = (index: number) => ReactNode;

export function TradeSummary({game,trade,playerId,pending,renderProperty,onRespond,onCounter,onCancel}:{
  game:Game;trade:Trade;playerId:string;pending:boolean;renderProperty:PropertyRenderer;
  onRespond:(accept:boolean)=>void;onCounter:()=>void;onCancel:()=>void;
}) {
  const incoming=trade.to===playerId;
  const other=game.players.find(player=>player.id===(incoming?trade.from:trade.to));
  const receive=incoming?trade.give:trade.take, give=incoming?trade.take:trade.give;
  const receiveCash=incoming?trade.giveCash:trade.takeCash, giveCash=incoming?trade.takeCash:trade.giveCash;
  return <>
    <div className="panel-kicker"><span/> {incoming?'ВАМ ПРЕДЛАГАЮТ':'ЖДЁМ ОТВЕТА'}</div>
    <h2>{trade.counterOf?'Встречное предложение':'Договор'}</h2>
    <p>{incoming?`${other?.name} ${trade.counterOf?'изменяет условия обмена':'предлагает вам сделку'}.`:`Предложение отправлено игроку ${other?.name}. Деньги и компании пока у владельцев.`}</p>
    <div className="trade-columns">
      <div><h3>Вы отдаёте</h3><p className="trade-cash">{money(giveCash)}</p>{give.map(index=><div className="trade-property" key={index}>{renderProperty(index)}<span>{tiles[index].name}{game.mortgaged.includes(index)?' · в залоге':''}</span></div>)}{!give.length&&<p className="trade-empty">Без компаний</p>}</div>
      <div><h3>Вы получаете</h3><p className="trade-cash">{money(receiveCash)}</p>{receive.map(index=><div className="trade-property" key={index}>{renderProperty(index)}<span>{tiles[index].name}{game.mortgaged.includes(index)?' · в залоге':''}</span></div>)}{!receive.length&&<p className="trade-empty">Без компаний</p>}</div>
    </div>
    <div className="trade-actions">
      {incoming?<>
        <button className="primary" disabled={pending} onClick={()=>onRespond(true)}>Принять</button>
        <button className="secondary" disabled={pending} onClick={onCounter}>Изменить условия</button>
        <button className="text-button" disabled={pending} onClick={()=>onRespond(false)}>Отклонить</button>
      </>:<button className="secondary" disabled={pending} onClick={onCancel}>Отменить предложение</button>}
    </div>
  </>;
}

export function TradeEditor({game,playerId,targetId,give,take,giveCash,takeCash,counter,pending,canDuel,renderProperty,onGiveCash,onTakeCash,onToggleGive,onToggleTake,onSubmit,onBack,onDuel}:{
  game:Game;playerId:string;targetId:string;give:number[];take:number[];giveCash:number;takeCash:number;
  counter:boolean;pending:boolean;canDuel:boolean;renderProperty:PropertyRenderer;
  onGiveCash:(amount:number)=>void;onTakeCash:(amount:number)=>void;onToggleGive:(index:number)=>void;onToggleTake:(index:number)=>void;
  onSubmit:()=>void;onBack:()=>void;onDuel:()=>void;
}) {
  const player=game.players.find(player=>player.id===playerId),target=game.players.find(player=>player.id===targetId);
  const valid=!!player&&!player.bankrupt&&!!target&&!target.bankrupt&&
    Number.isSafeInteger(giveCash)&&giveCash>=0&&giveCash<=player.money&&Number.isSafeInteger(takeCash)&&takeCash>=0&&takeCash<=target.money&&
    give.every(index=>game.owners[index]===playerId)&&take.every(index=>game.owners[index]===targetId);
  return <>
    <div className="panel-kicker"><span/> {counter?'ТОРГУЕМСЯ':`ОБМЕН · ${target?.name}`}</div>
    <h2>{counter?'Встречное предложение':'Договор'}</h2>
    {!counter&&<button className="secondary" disabled={pending||!canDuel} title="Дуэль доступна в свой ход до броска, один раз за ход, при наличии 100k у обоих игроков и без незавершённой сделки" onClick={onDuel}>Дуэль</button>}
    <p>{counter?'Измените суммы и компании. После отправки соперник сможет принять ваши условия или предложить свои.':'Нажимайте на компании на поле, чтобы добавить их в обмен.'}</p>
    {counter&&<p className="trade-hint">Компании выбираются на поле; нажатие на выбранную убирает её из обмена.</p>}
    <div className="trade-columns">
      <div><h3>Вы предлагаете</h3><label>ДЕНЬГИ, K<input aria-label="Вы предлагаете деньги" type="number" min="0" max={player?.money} step="1" disabled={pending} value={giveCash||''} placeholder="0" onChange={event=>onGiveCash(Math.max(0,Math.floor(Number(event.target.value)||0)))}/></label>
        {give.map(index=><button type="button" className="trade-property trade-property-remove" disabled={pending} aria-label={`Убрать ${tiles[index].name} из предложения`} onClick={()=>onToggleGive(index)} key={index}>{renderProperty(index)}<span>{tiles[index].name}{game.mortgaged.includes(index)?' · в залоге':''}</span><span aria-hidden="true">×</span></button>)}
      </div>
      <div><h3>{target?.name} отдаёт</h3><label>ДЕНЬГИ, K<input aria-label="Игрок отдаёт деньги" type="number" min="0" max={target?.money} step="1" disabled={pending} value={takeCash||''} placeholder="0" onChange={event=>onTakeCash(Math.max(0,Math.floor(Number(event.target.value)||0)))}/></label>
        {take.map(index=><button type="button" className="trade-property trade-property-remove" disabled={pending} aria-label={`Убрать ${tiles[index].name} из запроса`} onClick={()=>onToggleTake(index)} key={index}>{renderProperty(index)}<span>{tiles[index].name}{game.mortgaged.includes(index)?' · в залоге':''}</span><span aria-hidden="true">×</span></button>)}
      </div>
    </div>
    {!valid&&<p role="status" className="trade-validation">Проверьте баланс и владельцев выбранных компаний: условия сделки изменились.</p>}
    <div className="trade-actions">
      <button className="primary" disabled={pending||!valid} onClick={onSubmit}>{pending?'Отправляем…':counter?'Отправить встречное предложение':'Предложить сделку'}</button>
      {counter&&<button className="text-button" disabled={pending} onClick={onBack}>Назад к предложению</button>}
    </div>
  </>;
}
