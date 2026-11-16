import {
  CAR_RENTS, DICE_RENT_FACTORS, DIAMOND_FEE, JACKPOT_BET, JACKPOT_PAYOUTS,
  LOAN_PRINCIPAL, LOAN_TOTAL_DUE, LOAN_TURNS, MAX_PROPERTY_LEVEL, MORTGAGE_TURNS,
  PROPERTY_RENTS, propertyUpgradeCost, tiles, type Game, type Tile,
} from './game';
import { AUCTION_BID_STEP } from './auction';
import { FULL_RANDOM_CARDS, type ChanceAmounts } from './chance';
import { DUEL_BET_STEP } from './duel';
import { ROULETTE_OUTCOMES, type RouletteOutcome } from './roulette';
import { TRAP_AMOUNTS, TRAP_COOLDOWN_ROUNDS, TRAP_LIFETIME_ROUNDS } from './traps';

export { mortgageValue, redemptionCost, upgradeResaleValue } from './game';
export type GameMode = 'classic' | 'fullRandom';

export type GameRules = {
  tiles: readonly Tile[];
  propertyRents: Readonly<Record<number, readonly number[]>>;
  upgradeCosts: Readonly<Record<number, readonly number[]>>;
  carRents: readonly number[];
  diceRentFactors: readonly number[];
  startingCash: number;
  passStart: number;
  landOnStart: number;
  jailFee: number;
  taxFee: number;
  diamondFee: number;
  loanPrincipal: number;
  loanTotalDue: number;
  loanTurns: number;
  mortgageTurns: number;
  mortgagePercent: number;
  redemptionPercent: number;
  upgradeResalePercent: number;
  numberGamePercent: number;
  jackpotBet: number;
  jackpotPayouts: Readonly<Record<number, number>>;
  rouletteBet: number;
  rouletteOutcomes: readonly RouletteOutcome[];
  chanceAmounts: Readonly<Record<string, ChanceAmounts>>;
  auctionStep: number;
  duelStep: number;
  trapAmounts: readonly number[];
  trapCostPercent: number;
  trapCooldownRounds: number;
  trapLifetimeRounds: number;
};

const classicUpgradeCosts = Object.fromEntries(Object.keys(PROPERTY_RENTS).map(index =>
  [index, Array.from({ length: MAX_PROPERTY_LEVEL }, () => propertyUpgradeCost(Number(index)))]));
const classicChanceAmounts: Record<string, ChanceAmounts> = Object.fromEntries(
  FULL_RANDOM_CARDS.flatMap(card => card.amounts ? [[card.id, card.amounts]] : []));

export const CLASSIC_RULES: GameRules = {
  tiles, propertyRents: PROPERTY_RENTS, upgradeCosts: classicUpgradeCosts,
  carRents: CAR_RENTS, diceRentFactors: DICE_RENT_FACTORS,
  startingCash: 15000, passStart: 2000, landOnStart: 3000, jailFee: 500, taxFee: 2000, diamondFee: DIAMOND_FEE,
  loanPrincipal: LOAN_PRINCIPAL, loanTotalDue: LOAN_TOTAL_DUE, loanTurns: LOAN_TURNS,
  mortgageTurns: MORTGAGE_TURNS, mortgagePercent: 50, redemptionPercent: 55, upgradeResalePercent: 50,
  numberGamePercent: 50, jackpotBet: JACKPOT_BET, jackpotPayouts: JACKPOT_PAYOUTS, rouletteBet: JACKPOT_BET, rouletteOutcomes: ROULETTE_OUTCOMES,
  chanceAmounts: classicChanceAmounts, auctionStep: AUCTION_BID_STEP, duelStep: DUEL_BET_STEP, trapAmounts: TRAP_AMOUNTS,
  trapCostPercent: 40, trapCooldownRounds: TRAP_COOLDOWN_ROUNDS, trapLifetimeRounds: TRAP_LIFETIME_ROUNDS,
};

export const rulesOf = (game?: Pick<Game,'rules'> | null): GameRules => game?.rules ?? CLASSIC_RULES;

export function generateRandomRules(random: () => number = Math.random): GameRules {
  // Inclusive uniform draw over multiples of step in the interval.
  const draw = (min: number, max: number, step = 1) => {
    const first = Math.ceil(min / step);
    const last = Math.floor(max / step);
    return (first + Math.floor(random() * (last - first + 1))) * step;
  };
  const vary = (base: number, step = 10) => Math.sign(base) * draw(Math.abs(base) / 2, Math.abs(base) * 1.5, step);
  function tiers(bases: readonly number[], step: number, initial = 0) {
    let previous = initial;
    return bases.map(base => {
      previous = draw(Math.max(base / 2, previous + step), base * 1.5, step);
      return previous;
    });
  }

  const passStart = vary(2000, 100);
  const loanPrincipal = vary(LOAN_PRINCIPAL, 250);
  const mortgagePercent = draw(35, 65, 5);
  const jackpotBet = vary(JACKPOT_BET, 100);
  const [twoNumbers, oneNumber] = tiers([2000, 5000], 100, jackpotBet);
  const rouletteBet = vary(JACKPOT_BET, 100);
  const [prize, start, jackpot] = tiers([2000, 3000, 5000], 100, rouletteBet);
  const weights = {
    refund: draw(23, 35), prize: draw(11, 19), extraRoll: draw(7, 13),
    start: draw(3, 7), jackpot: draw(3, 7), jail: draw(3, 7),
  };
  const chances = { ...weights, empty: 100 - Object.values(weights).reduce((sum, n) => sum + n, 0) };
  const payouts = { empty: 0, refund: rouletteBet, prize, extraRoll: rouletteBet, start, jackpot, jail: 0 };
  const rouletteOutcomes = ROULETTE_OUTCOMES.map(outcome => {
    const payout = payouts[outcome.id];
    let description: string = outcome.description;
    const label = payout.toLocaleString('ru-RU') + 'k';
    if (outcome.id === 'refund') description = 'Банк возвращает вашу ставку ' + label + '.';
    if (outcome.id === 'prize' || outcome.id === 'jackpot') description = 'Банк выплачивает вам ' + label + '.';
    if (outcome.id === 'start') description = 'Переместитесь на старт и получите ' + label + '.';
    return { ...outcome, payout, chance: chances[outcome.id], description };
  });

  return {
    tiles: tiles.map(tile => tile.price ? { ...tile, price: vary(tile.price, 50) } : { ...tile }),
    propertyRents: Object.fromEntries(Object.entries(PROPERTY_RENTS).map(([index, rents]) => [index, tiers(rents, 5)])),
    upgradeCosts: Object.fromEntries(Object.entries(classicUpgradeCosts).map(([index, costs]) =>
      [index, costs.map(cost => vary(cost, 50))])),
    carRents: tiers(CAR_RENTS, 25), diceRentFactors: tiers(DICE_RENT_FACTORS, 5),
    startingCash: draw(10000, 20000, 500), passStart,
    landOnStart: draw(Math.max(passStart + 100, 1500), 4500, 100),
    taxFee: draw(1800, 2000, 100), diamondFee: draw(900, DIAMOND_FEE, 50), jailFee: vary(500, 50),
    loanPrincipal, loanTotalDue: loanPrincipal + Math.ceil(loanPrincipal * draw(5, 25) / 100),
    loanTurns: draw(8, 22), mortgageTurns: draw(8, 22),
    mortgagePercent, redemptionPercent: mortgagePercent + draw(5, 15, 5), upgradeResalePercent: draw(30, 65, 5),
    numberGamePercent: draw(35, 65, 5),
    jackpotBet, jackpotPayouts: { 1: oneNumber, 2: twoNumbers, 3: jackpotBet }, rouletteBet, rouletteOutcomes,
    chanceAmounts: Object.fromEntries(Object.entries(classicChanceAmounts).map(([id, amounts]) =>
      [id, { base: vary(amounts.base, 5), ...(amounts.perUnit ? { perUnit: vary(amounts.perUnit, 5) } : {}) }])),
    auctionStep: draw(100, 200, 50), duelStep: draw(50, 150, 50),
    trapAmounts: tiers(TRAP_AMOUNTS, 50), trapCostPercent: draw(25, 55, 5),
    trapCooldownRounds: draw(5, 15), trapLifetimeRounds: draw(5, 15),
  };
}
