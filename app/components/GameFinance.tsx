'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LOAN_PRINCIPAL, LOAN_TOTAL_DUE, LOAN_TURNS, money, type Game, type Player } from '@/lib/game';
import styles from './GameFinance.module.css';

type Action = (action: string, extra?: Record<string, unknown>) => Promise<Game | null>;

function Dialog({ title, icon, children, onClose }: { title: string; icon: string; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); onClose?.(); }}>
    {onClose && <button className={styles.close} onClick={onClose} aria-label="Закрыть окно">×</button>}
    <div className={styles.icon} aria-hidden="true">{icon}</div>
    <h2>{title}</h2>
    {children}
  </dialog>;
}

function LoanTerms() {
  return <dl className={styles.terms}>
    <div><dt>Получите сейчас</dt><dd>{money(LOAN_PRINCIPAL)}</dd></div>
    <div><dt>Вернёте с процентами</dt><dd>{money(LOAN_TOTAL_DUE)}</dd></div>
    <div><dt>Срок</dt><dd>{LOAN_TURNS} своих ходов</dd></div>
  </dl>;
}

export function FinancePanel({ game, player, moving, action }: { game: Game; player: Player; moving: boolean; action: Action }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const isMyTurn = game.players[game.turn]?.id === player.id;
  const available = isMyTurn && !moving && !player.bankrupt && game.phase !== 'finished' && game.phase !== 'auction';
  const canRepay = available && game.phase !== 'pay' && player.money >= (player.loan?.totalDue ?? LOAN_TOTAL_DUE);
  async function submit(kind: 'loanTake' | 'loanRepay') {
    setPending(true); setFailed(false);
    const result = await action(kind);
    setPending(false);
    if (result) setOpen(false); else setFailed(true);
  }
  if (!game.started || player.bankrupt || game.phase === 'finished') return null;
  return <section className={styles.bank} aria-label="Банк и кредит">
    <div className={styles.bankHeading}><span>БАНК</span><span>↗</span></div>
    {player.loan ? <>
      <strong>{money(player.loan.totalDue)} <small>к возврату</small></strong>
      <p>{player.loan.turnsLeft > 0 ? `Срок через ${player.loan.turnsLeft} своих ходов` : 'Срок наступил — погасите кредит'}</p>
      <progress value={Math.max(0, LOAN_TURNS - player.loan.turnsLeft)} max={LOAN_TURNS} aria-label="Срок кредита" />
      <button className="secondary" onClick={() => { setFailed(false); setOpen(true); }}>Условия и погашение</button>
    </> : player.loanUsed ? <p>Кредит погашен. Доступен один кредит за партию.</p> : <>
      <strong>Нужны средства?</strong>
      <p>{money(LOAN_PRINCIPAL)} на {LOAN_TURNS} своих ходов</p>
      <button className="secondary" onClick={() => { setFailed(false); setOpen(true); }}>Взять кредит</button>
    </>}
    {open && <Dialog title={player.loan ? 'Ваш кредит' : 'Кредит на развитие'} icon="↗" onClose={() => setOpen(false)}>
      <p>Один кредит за партию. Проценты фиксированные, досрочное погашение без дополнительной комиссии.</p>
      <LoanTerms />
      <p className={styles.note}>Ход, в котором вы взяли кредит, входит в срок. После пяти завершённых ходов возврат обязателен перед следующим броском. При нехватке денег можно продать улучшения или заложить компании.</p>
      {failed && <p role="alert" className={styles.error}>Не удалось выполнить операцию. Проверьте текущий ход и доступный баланс.</p>}
      {player.loan ? <button className="primary big" disabled={pending || !canRepay} onClick={() => void submit('loanRepay')}>Вернуть {money(player.loan.totalDue)}</button> : <button className="primary big" disabled={pending || !available || player.loanUsed} onClick={() => void submit('loanTake')}>Получить {money(LOAN_PRINCIPAL)}</button>}
      {!isMyTurn && <p className={styles.note}>Кредитные операции доступны в ваш ход.</p>}
      {game.phase === 'auction' && <p className={styles.note}>Кредитные операции доступны после завершения аукциона.</p>}
      {player.loan && game.phase === 'pay' && <p className={styles.note}>Сначала подтвердите обязательный платёж на игровом поле.</p>}
      {player.loan && player.money < player.loan.totalDue && <p className={styles.note}>Для возврата не хватает {money(player.loan.totalDue - player.money)}.</p>}
    </Dialog>}
  </section>;
}

export function GameEvents({ game, player, moving, action }: { game: Game; player: Player; moving: boolean; action: Action }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (moving || game.players[game.turn]?.id !== player.id || player.bankrupt) return null;
  const chance = game.phase === 'chanceResult' ? game.chanceResult ?? {id: 'legacy-chance', title: 'Шанс завершён', description: 'Награда уже получена. Подтвердите карточку, чтобы продолжить игру.', amount: 0, playerId: player.id} : undefined;
  const debt = game.phase === 'pay' && game.debt?.kind ? game.debt : undefined;
  if (!chance && !debt) return null;
  const key = `${game.code}:${game.turnSerial}:${game.rollSeq}:${chance?.id ?? debt?.kind}:${debt?.amount ?? ''}`;
  const title = chance?.title ?? (debt?.kind === 'diamond' ? 'Налог на роскошь' : debt?.kind === 'loan' ? 'Пора вернуть кредит' : debt?.reason ?? 'Обязательный платёж');
  const amount = chance?.amount ?? -(debt?.amount ?? 0);
  const enough = !debt || player.money >= debt.amount;
  const canBorrow = !!debt && !enough && !player.loan && !player.loanUsed;
  async function submit(kind: string) {
    setPending(true); setFailed(false);
    const result = await action(kind);
    setPending(false); setFailed(!result);
  }
  return <>
    <button className="text-button" onClick={() => { setFailed(false); setDismissed(null); }}>{chance ? 'Открыть карточку шанса' : 'Открыть платёж'}</button>
    {dismissed !== key && <Dialog title={title} icon={chance ? '?' : debt?.kind === 'diamond' ? '◇' : debt?.kind === 'loan' ? '↗' : '−'} onClose={() => setDismissed(key)}>
      <span className={styles.kicker}>{chance ? 'ШАНС' : debt?.kind === 'diamond' ? 'КЛЕТКА «БРИЛЛИАНТ»' : 'ПЛАТЁЖ В БАНК'}</span>
      <p>{chance?.description ?? (debt?.kind === 'diamond' ? 'Вы остановились на бриллианте. Оплатите налог на роскошь, чтобы продолжить игру.' : debt?.kind === 'loan' ? 'Пять ваших ходов завершены. После возврата кредита вы продолжите свой ход.' : debt?.reason)}</p>
      <div className={`${styles.amount} ${amount >= 0 ? styles.gain : styles.loss}`}>{amount > 0 ? '+' : amount < 0 ? '−' : ''}{money(Math.abs(amount))}</div>
      <div className={styles.balance}>На вашем счёте <strong>{money(player.money)}</strong></div>
      {!enough && <p className={styles.error}>Не хватает {money((debt?.amount ?? 0) - player.money)}. Продайте улучшения, заложите компанию{canBorrow ? ' или возьмите кредит' : ''}.</p>}
      {failed && <p role="alert" className={styles.error}>Операция не выполнена. Проверьте баланс и дождитесь завершения движения.</p>}
      <button className="primary big" disabled={pending || !enough} onClick={() => void submit(chance ? 'chanceContinue' : 'pay')}>{chance ? amount > 0 ? 'Получить деньги' : amount < 0 ? 'Перейти к оплате' : 'Продолжить' : `Оплатить ${money(debt?.amount ?? 0)}`}</button>
      {canBorrow && <>
        <button className="secondary" disabled={pending} onClick={() => void submit('loanTake')}>Взять кредит · +{money(LOAN_PRINCIPAL)}</button>
        <p className={styles.note}>Вернуть {money(LOAN_TOTAL_DUE)} через {LOAN_TURNS} своих ходов. Один кредит за партию.</p>
      </>}
      {debt && <button className="text-button" onClick={() => setDismissed(key)}>Управлять имуществом</button>}
      <p className={styles.note}>{chance ? 'Эффект карточки применяется после подтверждения.' : 'Деньги спишутся только после подтверждения оплаты.'}</p>
    </Dialog>}
  </>;
}
