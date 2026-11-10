export const ROULETTE_SPIN_MS = 3000;

export const ROULETTE_OUTCOMES = [
  {id:'empty',title:'Пусто',description:'Ставка проиграна. Удача ещё улыбнётся!',payout:0,color:'#555b68',symbol:'—'},
  {id:'refund',title:'Возврат ставки',description:'Банк возвращает ставку 1 000k.',payout:1000,color:'#527b9b',symbol:'↩'},
  {id:'prize',title:'Денежный приз',description:'Получите 2 000k: чистый выигрыш 1 000k.',payout:2000,color:'#689d54',symbol:'+'},
  {id:'extraRoll',title:'Дополнительный бросок',description:'Ставка возвращается полностью. Бросьте кубики ещё раз!',payout:1000,color:'#9574bf',symbol:'⚄'},
  {id:'start',title:'На старт',description:'Переместитесь на старт и получите 3 000k.',payout:3000,color:'#3a9d96',symbol:'↗'},
  {id:'jackpot',title:'Джекпот',description:'Ваш приз — 5 000k: чистый выигрыш 4 000k!',payout:5000,color:'#c79535',symbol:'★'},
  {id:'jail',title:'В тюрьму',description:'Отправляйтесь в тюрьму. Ход заканчивается.',payout:0,color:'#b85d66',symbol:'▥'},
] as const;

export type RouletteOutcomeId = typeof ROULETTE_OUTCOMES[number]['id'];

export function drawRoulette() {
  return ROULETTE_OUTCOMES[Math.floor(Math.random() * ROULETTE_OUTCOMES.length)];
}
