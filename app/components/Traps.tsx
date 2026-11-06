import { useState, type CSSProperties } from 'react';
import { TRAP_AMOUNTS, TRAP_LIFETIME_ROUNDS, trapCost } from '@/lib/traps';
import { liquidFunds, money, tiles, type Game } from '@/lib/game';
import styles from './Traps.module.css';

type Action = (action: string, extra?: Record<string, unknown>) => Promise<Game | null>;

export function TrapMarker({trap,bounds}:{trap:NonNullable<Game['myTrap']>;bounds:CSSProperties}) {
  const label=`Ваша ловушка: ${tiles[trap.tile].name}, штраф ${money(trap.amount)}, полных кругов осталось: ${trap.roundsLeft}`;
  return <div className={styles.marker} style={bounds} role="img" aria-label={label} title={label}>
    <span className={styles.markerBadge} aria-hidden="true"><span>ЛОВУШКА</span><b>{money(trap.amount)}</b><span>{trap.roundsLeft} круг.</span></span>
  </div>;
}

export function TrapSetup({game,playerId,tile,available,onAction,onCancel,onPlaced}:{game:Game;playerId:string;tile:number;available:boolean;onAction:Action;onCancel:()=>void;onPlaced:()=>void}) {
  const [amount,setAmount]=useState<number>(500);
  const [pending,setPending]=useState(false);
  const player=game.players.find(p=>p.id===playerId)!;
  const cost=trapCost(amount);
  async function place() {
    if(pending||!available||player.money<cost)return;
    setPending(true);
    try { if(await onAction('trapPlace',{tile,amount}))onPlaced(); }
    finally { setPending(false); }
  }
  return <section className={styles.setup} aria-label="Установка ловушки">
    <fieldset disabled={pending}>
      <legend>Штраф ловушки</legend>
      <div className={styles.choices}>{TRAP_AMOUNTS.map(value=><label key={value} className={amount===value?styles.chosen:''}>
        <input type="radio" name="trap-amount" value={value} checked={amount===value} disabled={player.money<trapCost(value)} onChange={()=>setAmount(value)}/>{money(value)}
      </label>)}</div>
    </fieldset>
    <p>Установка: <strong>{money(cost)}</strong></p>
    <p className={styles.note}>Работает {TRAP_LIFETIME_ROUNDS} полных кругов. Следующая установка — через 10 кругов. Клетку и сумму видите только вы.</p>
    <p className={styles.note}>Если попадётесь сами, штраф уйдёт банку.</p>
    <button className="primary" disabled={pending||!available||player.money<cost} onClick={()=>void place()}>Установить за {money(cost)}</button>
    <button className="secondary" disabled={pending} onClick={onCancel}>Назад</button>
  </section>;
}

export function TrapStatus({game}:{game:Game}) {
  if(!game.started||game.phase==='finished')return null;
  return <section className={styles.status} aria-label="Ваши ловушки">
    <strong>ЛОВУШКИ</strong>
    {game.myTrap?<><p>Ваша ловушка: {tiles[game.myTrap.tile].name}</p><p>Штраф {money(game.myTrap.amount)} · полных кругов осталось: {game.myTrap.roundsLeft}</p></>:<p>{game.trapCooldown?'Активных ловушек нет.':'Нажмите на свободную компанию, чтобы поставить скрытую ловушку.'}</p>}
    <p>{game.trapCooldown?`Следующая установка через ${game.trapCooldown} полных кругов.`:'Доступна одна установка за 10 полных кругов.'}</p>
    {game.myTrap&&<p>Ваш баланс показывает доступные деньги. Для соперников он включает резерв установки до раскрытия ловушки.</p>}
  </section>;
}

export function TrapReveal({game,playerId,onAction}:{game:Game;playerId:string;onAction:Action}) {
  const [pending,setPending]=useState(false);
  const result=game.trapResult!,player=game.players.find(p=>p.id===result.playerId)!,owner=game.players.find(p=>p.id===result.ownerId)!;
  const mine=player.id===playerId,enough=player.money>=result.amount;
  const canBorrow=mine&&!enough&&!player.loan&&!player.loanUsed;
  const canBankrupt=mine&&liquidFunds(game,player)<result.amount;
  async function send(kind:string) {
    if(pending)return;
    setPending(true);
    try { await onAction(kind); }
    finally { setPending(false); }
  }
  return <section className={styles.reveal} aria-label="Ловушка">
    <span className={styles.kicker}>ЛОВУШКА СРАБОТАЛА</span>
    <h2>{player.name} попался!</h2>
    <p>Ловушка игрока <strong style={{color:owner.color}}>{owner.name}</strong> на «{tiles[result.tile].name}»</p>
    <strong className={styles.amount}>{money(result.amount)}</strong>
    <p>{player.id===owner.id?`${player.name} попадает в собственную ловушку. Штраф получает банк.`:`Штраф получает ${owner.name}.`}</p>
    {mine?<>
      {!enough&&<p className={styles.error}>{canBankrupt?'Стоимость доступного имущества не покрывает долг.':`Не хватает ${money(result.amount-player.money)}. Возьмите кредит или заложите имущество.`}</p>}
      <button className="primary" disabled={pending||!enough} onClick={()=>void send('pay')}>Оплатить {money(result.amount)}</button>
      {canBorrow&&<button className="secondary" disabled={pending} onClick={()=>void send('loanTake')}>Взять кредит</button>}
      {canBankrupt&&<button className="text-button danger-text" disabled={pending} onClick={()=>void send('bankrupt')}>Объявить банкротство</button>}
    </>:<p className={styles.note}>Ждём оплаты от {player.name}.</p>}
    <p className={styles.note}>После оплаты продолжится действие клетки. Ловушка уже снята.</p>
  </section>;
}
