import { useState } from 'react';
import { money, type Game } from '@/lib/game';
import { rulesOf, type GameMode } from '@/lib/rules';
import { Dialog } from './GameFinance';
import styles from './GameFinance.module.css';

const labels: Record<GameMode, string> = { classic: 'Классика', fullRandom: 'Фулл рандом' };

export function LobbyMode({ mode, host, pending, onSelect }: {
  mode: GameMode; host: boolean; pending: boolean; onSelect: (mode: GameMode) => void;
}) {
  return <div className="lobby-mode">
    {host ? <fieldset disabled={pending}>
      <legend>Режим игры</legend>
      {(['classic', 'fullRandom'] as const).map(option =>
        <label key={option}>
          <input type="radio" name="game-mode" checked={mode === option} onChange={() => onSelect(option)} />
          <span>{labels[option]}</span>
        </label>
      )}
    </fieldset> : <strong>Режим игры · {labels[mode]}</strong>}
    <p>{mode === 'fullRandom'
      ? 'На старте разыграются цены, ставки и выплаты на всю партию. «Шанс» может поменять фишки местами или подарить компанию.'
      : 'Обычные цены и выплаты. Для старта нужны хотя бы два игрока.'}</p>
  </div>;
}

export function RandomRulesSummary({ game }: { game: Game }) {
  const [open, setOpen] = useState(false);
  const rules = rulesOf(game);
  return <>
    <button className="random-rules-button" aria-label="Фулл рандом — условия партии" onClick={() => setOpen(true)}>
      Фулл рандом <span aria-hidden="true">ⓘ</span>
    </button>
    {open && <Dialog title="Фулл рандом" icon="⚄" onClose={() => setOpen(false)}>
      <p>Эти условия общие для всех до конца партии. Стоимость покупки, аренду и улучшения можно посмотреть в карточке компании.</p>
      <dl className={styles.terms}>
        <div><dt>Стартовый капитал</dt><dd>{money(rules.startingCash)}</dd></div>
        <div><dt>Проход через старт</dt><dd>+{money(rules.passStart)}</dd></div>
        <div><dt>Остановка на старте</dt><dd>+{money(rules.landOnStart)}</dd></div>
        <div><dt>Клетка «Деньги»</dt><dd>−{money(rules.taxFee)}</dd></div>
        <div><dt>Клетка «Бриллиант»</dt><dd>−{money(rules.diamondFee)}</dd></div>
        <div><dt>Выход из тюрьмы</dt><dd>{money(rules.jailFee)}</dd></div>
        <div><dt>Шаг аукциона</dt><dd>{money(rules.auctionStep)}</dd></div>
        <div><dt>На «Джекпоте» · числа / колесо</dt><dd>{rules.numberGamePercent}% / {100 - rules.numberGamePercent}%</dd></div>
        <div><dt>Залог / выкуп от цены</dt><dd>{rules.mortgagePercent}% / {rules.redemptionPercent}%</dd></div>
        <div><dt>Продажа улучшений</dt><dd>{rules.upgradeResalePercent}%</dd></div>
      </dl>
      <details className="roulette-odds">
        <summary>Шансы на колесе · ставка {money(rules.rouletteBet)}</summary>
        <dl className={styles.terms}>
          {rules.rouletteOutcomes.map(outcome => <div key={outcome.id}><dt>{outcome.title}</dt><dd>{outcome.chance}%</dd></div>)}
        </dl>
      </details>
    </Dialog>}
  </>;
}
