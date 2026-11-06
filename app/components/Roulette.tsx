import { useEffect, useState, type CSSProperties } from 'react';
import { JACKPOT_BET, money, type Game } from '@/lib/game';
import { ROULETTE_OUTCOMES, ROULETTE_SPIN_MS } from '@/lib/roulette';
import styles from './Roulette.module.css';

const sectorAngle = 360 / ROULETTE_OUTCOMES.length;
const sectors = ROULETTE_OUTCOMES.map((outcome,index) => ({...outcome,start:index*sectorAngle,end:(index+1)*sectorAngle,middle:(index+0.5)*sectorAngle}));
const background = `conic-gradient(${sectors.map(sector => `${sector.color} ${sector.start}deg ${sector.end}deg`).join(',')})`;

export function Roulette({game,myTurn,moving,onAction}:{game:Game;myTurn:boolean;moving:boolean;onAction:(action:string)=>Promise<Game|null>}) {
  const result = sectors.find(sector => sector.id === game.rouletteResult?.outcome);
  const stopAngle = result ? result.start+sectorAngle*(game.rouletteResult?.stopPosition??0.5) : 0;
  const showingResult = game.phase === 'rouletteResult';
  const [duration] = useState(() => showingResult ? Math.max(0,(game.animationUntil||0)-Date.now()) : 0);
  const [revealed,setRevealed] = useState(false);
  const [pending,setPending] = useState(false);
  useEffect(() => {
    if(!showingResult)return;
    const timer = setTimeout(() => setRevealed(true),duration+60);
    return () => clearTimeout(timer);
  },[showingResult,duration]);
  const send = async (action:string) => {
    if(pending)return;
    setPending(true);
    try { await onAction(action); }
    finally { setPending(false); }
  };
  const player = game.players[game.turn];
  const skip = !showingResult&&player.money<JACKPOT_BET;
  const buttonAction = showingResult?'rouletteContinue':skip?'rouletteSkip':'rouletteSpin';
  const buttonLabel = showingResult?(revealed?'Продолжить':'Крутим…'):skip?'Пропустить':`Крутить за ${money(JACKPOT_BET)}`;

  return <section className={styles.panel} aria-label="Рулетка">
      <div className={styles.wheelWrap}>
        <span className={styles.pointer} aria-hidden="true" />
        <div className={`${styles.wheel} ${showingResult?styles.spinning:''}`} role="img" aria-label="Колесо с 7 равными секторами" aria-describedby={sectors.map(sector=>`roulette-sector-${sector.id}`).join(' ')} style={{background,'--stop-angle':`${1800+360-stopAngle}deg`,animationDuration:`${ROULETTE_SPIN_MS}ms`,animationDelay:`${Math.min(0,duration-ROULETTE_SPIN_MS)}ms`} as CSSProperties}>
          {sectors.map(sector=><span key={sector.id} id={`roulette-sector-${sector.id}`} className={styles.sector} data-selected={revealed&&result?.id===sector.id} style={{transform:`translate(-50%, -50%) rotate(${sector.middle}deg) translateY(calc(var(--wheel-size) * -0.32))`}}>
            <strong>{sector.title}</strong>
            <span className={styles.payout}>{sector.payout?money(sector.payout):sector.id==='jail'?'Конец хода':'Без выигрыша'}</span>
          </span>)}
        </div>
        <span className={styles.hub} aria-hidden="true" />
      </div>
    <button className={`primary ${styles.control}`} disabled={!myTurn||moving||pending||(showingResult&&!revealed)} title={!myTurn?`Ход игрока ${player.name}`:undefined} onClick={()=>send(buttonAction)}>{buttonLabel}</button>
    <output className={styles.status} role="status" aria-live="polite">{showingResult?(revealed&&result?`${result.title}. ${result.description}`:'Крутим колесо…'):''}</output>
  </section>;
}
