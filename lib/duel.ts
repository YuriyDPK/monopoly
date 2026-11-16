export const DUEL_MIN_BET = 100;
export const DUEL_BET_STEP = 100;
export const DUEL_ROLL_MS = 1800;

export type Duel = {
  id: string;
  from: string;
  to: string;
  bet: number;
  dice?: [[number, number], [number, number]];
  winner?: string;
};

export const maxDuelBet = (firstBalance: number, secondBalance: number, step = DUEL_BET_STEP) =>
  Math.max(0, Math.floor(Math.min(firstBalance, secondBalance) / step) * step);
