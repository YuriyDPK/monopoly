import { isCarCompany, isDiceRent, type ChanceResult, type Game, type Player } from './game';

export type ChanceAmounts = { base: number; perUnit?: number };
type ChanceCard = {
  id: string;
  title: string;
  description: string;
  amounts?: ChanceAmounts;
  unit?: 'company' | 'upgrade' | 'rival' | 'mortgage';
  movement?: ChanceResult['movement'];
  effect?: ChanceResult['effect'];
  reverseNextMove?: boolean;
  skipNextTurn?: boolean;
};

export const CHANCE_CARDS: readonly ChanceCard[] = [
  {id:'dividend',title:'Дивиденды',description:'Ваши инвестиции принесли доход. Банк выплачивает {base}.',amounts:{base:500}},
  {id:'award',title:'Предприниматель года',description:'Премия за деловую хватку: получите {base}.',amounts:{base:1000}},
  {id:'refund',title:'Возврат налога',description:'В расчётах нашли переплату. Банк возвращает вам {base}.',amounts:{base:300}},
  {id:'inheritance',title:'Неожиданное наследство',description:'Дальний родственник оставил вам {base}.',amounts:{base:1500}},
  {id:'sale',title:'Удачная сделка',description:'Продажа старого оборудования принесла {base}.',amounts:{base:700}},
  {id:'portfolio',title:'Рост бизнеса',description:'Получите {base} и ещё по {unit} за каждую свою компанию.',amounts:{base:200,perUnit:100},unit:'company'},
  {id:'fine',title:'Штраф за парковку',description:'Оплатите штраф {base} в пользу банка.',amounts:{base:-200}},
  {id:'insurance',title:'Страховой взнос',description:'Пришло время продлить страховку: {base}.',amounts:{base:-400}},
  {id:'audit',title:'Налоговая проверка',description:'Обнаружена задолженность. Уплатите банку {base}.',amounts:{base:-800}},
  {id:'advertising',title:'Рекламная кампания',description:'Рекламный счёт составил {base}.',amounts:{base:-600}},
  {id:'repairs',title:'Плановый ремонт',description:'Заплатите {base} за обслуживание и по {unit} за каждое улучшение своих компаний.',amounts:{base:-250,perUnit:-150},unit:'upgrade'},
  {id:'licenses',title:'Продление лицензий',description:'Заплатите {base} и по {unit} за каждую свою компанию.',amounts:{base:-100,perUnit:-100},unit:'company'},
  {id:'nearest-company',title:'Новые возможности',description:'Переместитесь вперёд к ближайшей свободной компании. Если свободных компаний нет, оставайтесь на месте.',movement:'nearestAvailableCompany'},
  {id:'reverse-direction',title:'Обратный ход',description:'Ваш следующий ход будет в обратном направлении. После него вы снова пойдёте вперёд.',reverseNextMove:true},
  {id:'skip-turn',title:'Вынужденная пауза',description:'Вы пропускаете свой следующий ход.',skipNextTurn:true},
];

export const FULL_RANDOM_CARDS: readonly ChanceCard[] = [
  ...CHANCE_CARDS,
  {id:'afterparty',title:'Афтепати за ваш счёт',description:'Заплатите банку {base} за зал и по {unit} за каждого соперника, который ещё в игре.',amounts:{base:-250,perUnit:-150},unit:'rival'},
  {id:'bailout',title:'Спасение утопающих',description:'Банк выдаёт вам {base} и ещё по {unit} за каждую заложенную вами компанию.',amounts:{base:300,perUnit:400},unit:'mortgage'},
  {id:'portal',title:'Портал',description:'Свободных компаний нет. Вы остаётесь на месте.',movement:'randomAvailableCompany'},
  {id:'body-swap',title:'Обмен телами',description:'Нет соперника для обмена. Все фишки остаются на месте.',effect:'swapPositions'},
  {id:'mirror-round',title:'Зеркальный круг',description:'У каждого игрока следующий ход по кубикам будет в обратную сторону.',effect:'reverseAll'},
  {id:'property-gift',title:'Компания в подарок',description:'У банка закончились свободные компании для подарка.',effect:'giftProperty'},
];

function countUnits(unit: ChanceCard['unit'], game: Game, player: Player): number {
  if (!unit) return 0;
  if (unit === 'rival') return game.players.filter(p => !p.bankrupt && p.id !== player.id).length;
  if (unit === 'mortgage') return game.mortgaged.filter(index => game.owners[index] === player.id).length;
  const owned = Object.keys(game.owners).map(Number).filter(index => game.owners[index] === player.id);
  if (unit === 'upgrade') return owned.reduce((sum,index) => sum + (game.levels?.[index] ?? 0), 0);
  return owned.length;
}

export function drawChance(game: Game, player: Player): ChanceResult {
  const cards = game.rules && game.mode === 'fullRandom' ? FULL_RANDOM_CARDS : CHANCE_CARDS;
  const card = cards[Math.floor(Math.random() * cards.length)];
  const amounts = game.rules?.chanceAmounts[card.id] ?? card.amounts;
  const base = amounts?.base ?? 0;
  const unit = amounts?.perUnit ?? 0;
  const format = (n: number) => Math.abs(n).toLocaleString('ru-RU') + 'k';
  let description = card.description.replace('{base}', format(base)).replace('{unit}', format(unit));
  let destination: number | undefined;
  let targetPlayerId: string | undefined;
  if (card.effect === 'swapPositions') {
    const opponents = game.players.filter(p => p.id !== player.id && !p.bankrupt && !p.jailed && p.position !== player.position);
    if (opponents.length) {
      const target = opponents[Math.floor(Math.random() * opponents.length)];
      targetPlayerId = target.id;
      description = 'Вы меняетесь клетками с игроком «' + target.name + '».';
    }
  }
  if ((card.movement === 'randomAvailableCompany' || card.effect === 'giftProperty') && game.rules) {
    const board = game.rules.tiles;
    let available = board.flatMap((tile, index) => tile.price && !game.owners[index] ? [index] : []);
    if (card.effect === 'giftProperty') {
      available = available.filter(i => !isCarCompany(i) && !isDiceRent(i)).sort((a, b) => board[a].price! - board[b].price!);
      available = available.slice(0, Math.ceil(available.length / 3));
    }
    if (available.length) {
      destination = available[Math.floor(Math.random() * available.length)];
      const company = '«' + board[destination].name + '»';
      description = card.effect === 'giftProperty'
        ? 'Банк дарит вам компанию ' + company + '.'
        : 'Портал переносит вас к компании ' + company + '. Премия за круг не начисляется.';
    }
  }
  return {
    id: card.id, title: card.title, description, playerId: player.id,
    amount: base + unit * countUnits(card.unit, game, player),
    ...(destination !== undefined ? { destination } : {}),
    ...(targetPlayerId !== undefined ? { targetPlayerId } : {}),
    ...(card.effect ? {effect: card.effect} : {}),
    ...(card.movement ? {movement: card.movement} : {}),
    ...(card.reverseNextMove ? {reverseNextMove: true} : {}),
    ...(card.skipNextTurn ? {skipNextTurn: true} : {}),
  };
}
