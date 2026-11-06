export const ROULETTE_SPIN_MS = 3000;

export const ROULETTE_OUTCOMES = [
  {id:'empty',title:'Пусто',description:'Ставка проиграна. Удача ещё улыбнётся!',chance:30,payout:0,color:'#555b68',symbol:'—'},
  {id:'refund',title:'Возврат ставки',description:'Банк возвращает ставку 1 000k.',chance:30,payout:1000,color:'#527b9b',symbol:'↩'},
  {id:'prize',title:'Денежный приз',description:'Получите 2 000k: чистый выигрыш 1 000k.',chance:15,payout:2000,color:'#689d54',symbol:'+'},
  {id:'extraRoll',title:'Дополнительный бросок',description:'Ставка возвращается полностью. Бросьте кубики ещё раз!',chance:10,payout:1000,color:'#9574bf',symbol:'⚄'},
  {id:'start',title:'На старт',description:'Переместитесь на старт и получите 3 000k.',chance:5,payout:3000,color:'#3a9d96',symbol:'↗'},
  {id:'jackpot',title:'Джекпот',description:'Ваш приз — 5 000k: чистый выигрыш 4 000k!',chance:5,payout:5000,color:'#c79535',symbol:'★'},
  {id:'jail',title:'В тюрьму',description:'Отправляйтесь в тюрьму. Ход заканчивается.',chance:5,payout:0,color:'#b85d66',symbol:'▥'},
] as const;

export type RouletteOutcomeId = typeof ROULETTE_OUTCOMES[number]['id'];

export function drawRoulette() {
  let ticket = Math.floor(Math.random() * 100);
  for (const outcome of ROULETTE_OUTCOMES) {
    if (ticket < outcome.chance) return outcome;
    ticket -= outcome.chance;
  }
  return ROULETTE_OUTCOMES[ROULETTE_OUTCOMES.length - 1];
}
