import type { Game } from './game';

export const TRAP_AMOUNTS = [500, 1000, 2000, 5000] as const;
export const TRAP_LIFETIME_ROUNDS = 10;
export const TRAP_COOLDOWN_ROUNDS = 10;
export const trapCost = (amount: number) => amount * 2 / 5;

export type TurnSnapshot = Record<string, number>;
export type Trap = {id: string; ownerId: string; tile: number; amount: number; cost: number; placedAfter: TurnSnapshot};
export type TrapResult = {ownerId: string; playerId: string; tile: number; amount: number};

export function fullRoundsSince(game: Pick<Game, 'players' | 'completedTurns'>, snapshot: TurnSnapshot) {
  const alive = game.players.filter(player => !player.bankrupt);
  return alive.length ? Math.max(0, Math.min(...alive.map(player => (game.completedTurns?.[player.id] || 0) - (snapshot[player.id] || 0)))) : 0;
}
