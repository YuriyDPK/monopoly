import { useEffect, useState } from 'react';
import { DUEL_BET_STEP, DUEL_MIN_BET, maxDuelBet } from '@/lib/duel';
import { money, type Game } from '@/lib/game';
import styles from './Duel.module.css';

type Action = (action: string, extra?: Record<string, unknown>) => Promise<Game | null>;

export function DuelSetup({game,playerId,opponentId,onAction,onClose}:{game:Game;playerId:string;opponentId:string;onAction:Action;onClose:()=>void}) {
  const player=game.players.find(p=>p.id===playerId)!;
  const opponents=game.players.filter(p=>p.id!==playerId&&!p.bankrupt);
  const [target,setTarget]=useState(opponentId);
  const opponent=opponents.find(p=>p.id===target);
  const maximum=maxDuelBet(player.money,opponent?.money||0);
  const [bet,setBet]=useState(String(Math.max(DUEL_MIN_BET,Math.min(500,maximum))));
  const [pending,setPending]=useState(false);
  const amount=Number(bet);
  const valid=Number.isSafeInteger(amount)&&amount>=DUEL_MIN_BET&&amount%DUEL_BET_STEP===0&&amount<=maximum;
  async function challenge() {
    if(pending||!valid)return;
    setPending(true);
    try { if(await onAction('duelChallenge',{to:target,bet:amount}))onClose(); }
    finally { setPending(false); }
  }
  return <section className={styles.panel} aria-label="Настройка дуэли">
    <h2>Дуэль</h2>
    <p className={styles.note}>Два кубика каждому. Большая сумма забирает банк.</p>
    <label className={styles.field}>Соперник
      <select aria-label="Соперник дуэли" value={target} disabled={pending} onChange={event=>{
        const next=opponents.find(p=>p.id===event.target.value)!;
        setTarget(next.id);
        setBet(String(Math.max(DUEL_MIN_BET,Math.min(Number(bet)||DUEL_MIN_BET,maxDuelBet(player.money,next.money)))));
      }}>
        {opponents.map(p=><option key={p.id} value={p.id}>{p.name}{p.bot?' · бот':''}</option>)}
      </select>
    </label>
    <label className={styles.stake}>Ставка с каждого, k
      <input aria-label="Ставка дуэли" type="number" min={DUEL_MIN_BET} max={maximum} step={DUEL_BET_STEP} value={bet} disabled={pending} onChange={event=>setBet(event.target.value)} />
    </label>
    <div className={styles.range}>
      <input aria-label="Ставка дуэли ползунок" type="range" min={DUEL_MIN_BET} max={Math.max(DUEL_MIN_BET,maximum)} step={DUEL_BET_STEP} value={Math.max(DUEL_MIN_BET,Math.min(maximum,Math.floor((amount||0)/DUEL_BET_STEP)*DUEL_BET_STEP))} disabled={pending||maximum<DUEL_MIN_BET} onChange={event=>setBet(event.target.value)} />
      <div><span>{money(DUEL_MIN_BET)}</span><span>Максимум {money(maximum)}</span></div>
    </div>
    <p className={styles.note}>{maximum<DUEL_MIN_BET?'У обоих игроков должно быть хотя бы 100k.':`Банк ${money(valid?amount*2:0)}. При ничьей ставки вернутся.`}</p>
    <div className={styles.actions}>
      <button className="primary" disabled={pending||!valid} onClick={()=>void challenge()}>Вызвать на дуэль</button>
      <button className="secondary" disabled={pending} onClick={onClose}>Назад</button>
    </div>
    <p className={styles.note}>Один вызов за ход. Деньги спишутся после принятия.</p>
  </section>;
}

const faces=['','⚀','⚁','⚂','⚃','⚄','⚅'];

export function DuelPanel({game,playerId,onAction}:{game:Game;playerId:string;onAction:Action}) {
  const duel=game.duel!;
  const participants=[game.players.find(p=>p.id===duel.from)!,game.players.find(p=>p.id===duel.to)!];
  const showingResult=game.phase==='duelResult';
  const [revealed,setRevealed]=useState(()=>showingResult&&Date.now()>=(game.animationUntil||0)+60);
  const [pending,setPending]=useState(false);
  useEffect(()=>{
    if(!showingResult)return;
    const timer=setTimeout(()=>setRevealed(true),Math.max(0,(game.animationUntil||0)-Date.now())+60);
    return ()=>clearTimeout(timer);
  },[showingResult,game.animationUntil]);
  async function send(action:string,extra:Record<string,unknown>={}) {
    if(pending)return;
    setPending(true);
    try { await onAction(action,{duelId:duel.id,...extra}); }
    finally { setPending(false); }
  }
  const winner=participants.find(p=>p.id===duel.winner);
  return <section className={styles.panel} aria-label="Дуэль">
    <h2>Дуэль</h2>
    <p className={styles.bank}>Банк <strong>{money(duel.bet*2)}</strong><span>по {money(duel.bet)} с каждого</span></p>
    <div className={styles.players}>
      {participants.map((player,index)=>{
        const dice=duel.dice?.[index];
        return <div key={player.id} className={`${styles.player} ${revealed&&winner?.id===player.id?styles.winner:''}`}>
          <strong style={{color:player.color}}>{player.name}</strong>
          {showingResult&&<>
            <div className={`${styles.dice} ${!revealed?styles.rolling:''}`} role="img" aria-label={`Кубики ${player.name}: ${revealed?dice?.join(' и '):'бросаем'}`}>
              {(revealed?dice:[1,6])?.map((value,i)=><span key={i} aria-hidden="true">{faces[value]}</span>)}
            </div>
            <b className={styles.total}>{revealed&&dice?dice[0]+dice[1]:'…'}</b>
          </>}
        </div>;
      })}
    </div>
    {showingResult?<>
      <p className={styles.result} role="status">{revealed?(winner?`${winner.name} побеждает`:'Ничья — ставки вернутся'):'Бросаем кубики…'}</p>
      {duel.from===playerId?<button className={`primary ${styles.continue}`} disabled={pending||!revealed} onClick={()=>void send('duelContinue')}>{revealed?'Продолжить':'Бросаем…'}</button>:<p className={styles.note}>{revealed?`Ждём продолжения от ${participants[0].name}`:'Оба игрока бросают одновременно'}</p>}
    </>:<>
      <p className={styles.note}>Ждём ответа от {participants[1].name}</p>
      {duel.to===playerId&&<div className={styles.actions}>
        <button className="primary" disabled={pending} onClick={()=>void send('duelRespond',{accept:true})}>Принять за {money(duel.bet)}</button>
        <button className="secondary" disabled={pending} onClick={()=>void send('duelRespond',{accept:false})}>Отказаться</button>
      </div>}
      {duel.from===playerId&&<button className={`secondary ${styles.continue}`} disabled={pending} onClick={()=>void send('duelCancel')}>Отменить вызов</button>}
      <p className={styles.note}>Деньги ещё не списаны. При отказе ставка сохраняется.</p>
    </>}
  </section>;
}
