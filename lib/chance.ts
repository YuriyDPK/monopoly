import type { ChanceResult, Game, Player } from './game';

type ChanceCard = {
  id: string;
  title: string;
  description: string;
  amount: number | ((game: Game, player: Player) => number);
  reverseNextMove?: boolean;
};

const properties = (game: Game, player: Player) => Object.keys(game.owners).map(Number).filter(index => game.owners[index] === player.id);

export const CHANCE_CARDS: readonly ChanceCard[] = [
  {id:'dividend',title:'Дивиденды',description:'Ваши инвестиции принесли доход. Банк выплачивает 500k.',amount:500},
  {id:'award',title:'Предприниматель года',description:'Премия за деловую хватку: получите 1 000k.',amount:1000},
  {id:'refund',title:'Возврат налога',description:'В расчётах нашли переплату. Банк возвращает вам 300k.',amount:300},
  {id:'inheritance',title:'Неожиданное наследство',description:'Дальний родственник оставил вам 1 500k.',amount:1500},
  {id:'sale',title:'Удачная сделка',description:'Продажа старого оборудования принесла 700k.',amount:700},
  {id:'portfolio',title:'Рост бизнеса',description:'Получите 200k и ещё по 100k за каждую свою компанию.',amount:(game,player)=>200+properties(game,player).length*100},
  {id:'fine',title:'Штраф за парковку',description:'Оплатите штраф 200k в пользу банка.',amount:-200},
  {id:'insurance',title:'Страховой взнос',description:'Пришло время продлить страховку: 400k.',amount:-400},
  {id:'audit',title:'Налоговая проверка',description:'Обнаружена задолженность. Уплатите банку 800k.',amount:-800},
  {id:'advertising',title:'Рекламная кампания',description:'Рекламный счёт составил 600k.',amount:-600},
  {id:'repairs',title:'Плановый ремонт',description:'Заплатите 250k за обслуживание и по 150k за каждое улучшение своих компаний.',amount:(game,player)=>-(250+properties(game,player).reduce((sum,index)=>sum+(game.levels?.[index]??0),0)*150)},
  {id:'licenses',title:'Продление лицензий',description:'Заплатите 100k и по 100k за каждую свою компанию.',amount:(game,player)=>-(100+properties(game,player).length*100)},
  {id:'reverse-direction',title:'Обратный ход',description:'Ваш следующий ход будет в обратном направлении. После него вы снова пойдёте вперёд.',amount:0,reverseNextMove:true},
];

export function drawChance(game: Game, player: Player): ChanceResult {
  const available = CHANCE_CARDS.filter(card => card.id !== game.lastChanceId);
  const card = available[Math.floor(Math.random() * available.length)];
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    amount: typeof card.amount === 'number' ? card.amount : card.amount(game, player),
    playerId: player.id,
    ...(card.reverseNextMove ? {reverseNextMove: true} : {}),
  };
}
