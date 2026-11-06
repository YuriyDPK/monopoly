export const DICE_ROLL_MS = 480;
export const TOKEN_STEP_MS = 240;
export type Tile = { name: string; price?: number; kind?: 'chance' | 'tax' | 'diamond' | 'jail' | 'start' | 'jackpot'; group?: string };
export const tiles: Tile[] = [
  {name:'Старт',kind:'start'}, {name:'Chanel',price:600,group:'pink'}, {name:'Шанс',kind:'chance'}, {name:'Balenciaga',price:600,group:'pink'}, {name:'Деньги',kind:'tax'}, {name:'Mercedes-Benz',price:2000,group:'red'}, {name:'Adidas',price:1000,group:'gold'}, {name:'Шанс',kind:'chance'}, {name:'Puma',price:1000,group:'gold'}, {name:'Lacoste',price:1200,group:'gold'},
  {name:'Тюрьма',kind:'jail'}, {name:'X',price:1400,group:'teal'}, {name:'Rockstar Games',price:1500,group:'brown'}, {name:'Instagram',price:1400,group:'teal'}, {name:'Telegram',price:1600,group:'teal'}, {name:'Audi',price:2000,group:'red'}, {name:'Coca-Cola',price:1800,group:'blue'}, {name:'Шанс',kind:'chance'}, {name:'Pepsi',price:1800,group:'blue'}, {name:'Fanta',price:2000,group:'blue'},
  {name:'Джекпот',kind:'jackpot'}, {name:'American Airlines',price:2200,group:'green'}, {name:'Шанс',kind:'chance'}, {name:'Lufthansa',price:2200,group:'green'}, {name:'British Airways',price:2400,group:'green'}, {name:'Tesla',price:2000,group:'red'}, {name:"McDonald's",price:2600,group:'cyan'}, {name:'Burger King',price:2600,group:'cyan'}, {name:'CD Projekt RED',price:1500,group:'brown'}, {name:'KFC',price:2800,group:'cyan'},
  {name:'Полиция',kind:'jail'}, {name:'NVIDIA',price:3000,group:'purple'}, {name:'Xiaomi',price:3000,group:'purple'}, {name:'Шанс',kind:'chance'}, {name:'Apple',price:3200,group:'purple'}, {name:'Porsche',price:2000,group:'red'}, {name:'Бриллиант',kind:'diamond'}, {name:'Anthropic',price:3500,group:'slate'}, {name:'Шанс',kind:'chance'}, {name:'OpenAI',price:4000,group:'slate'},
];
export const MAX_PROPERTY_LEVEL = 5;
export const MORTGAGE_TURNS = 15;
export const JACKPOT_BET = 1000;
export const JACKPOT_PAYOUTS:Record<number,number> = {1:5000,2:2000,3:1000};
export const DIAMOND_FEE = 1000;
export const LOAN_PRINCIPAL = 5000;
export const LOAN_TOTAL_DUE = 5500;
export const LOAN_TURNS = 15;
export const CAR_COMPANIES = [5,15,25,35] as const;
export const isCarCompany = (i:number) => (CAR_COMPANIES as readonly number[]).includes(i);
export const carRent = (owners:Record<number,string>, i:number) => {const owner=owners[i];if(!owner)return 250;const count=CAR_COMPANIES.filter(index=>owners[index]===owner).length;return [250,500,1000,2000][Math.max(0,count-1)]};
export const isDiceRent = (i:number) => i === 12 || i === 28;
export const diceRentFactor = (owners:Record<number,string>, i:number) => owners[i] && owners[12] === owners[i] && owners[28] === owners[i] ? 250 : 100;
// Base rent, full street, then one through five improvements. Values are in k.
export const PROPERTY_RENTS: Readonly<Record<number, readonly number[]>> = {
  1: [20, 60, 100, 300, 900, 1600, 2500],
  3: [40, 120, 200, 600, 1800, 3200, 4500],
  6: [60, 180, 300, 900, 2700, 4000, 5500],
  8: [60, 180, 300, 900, 2700, 4000, 5500],
  9: [80, 240, 400, 1000, 3000, 4500, 6000],
  11: [100, 300, 500, 1500, 4500, 6250, 7500],
  13: [100, 300, 500, 1500, 4500, 6250, 7500],
  14: [120, 360, 600, 1800, 5000, 7000, 9000],
  16: [140, 420, 700, 2000, 5500, 7500, 9500],
  18: [140, 420, 700, 2000, 5500, 7500, 9500],
  19: [160, 480, 800, 2200, 6000, 8000, 10000],
  21: [180, 540, 900, 2500, 7000, 8750, 10500],
  23: [180, 540, 900, 2500, 7000, 8750, 10500],
  24: [200, 600, 1000, 3000, 7500, 9250, 11000],
  26: [220, 660, 1100, 3300, 8000, 9750, 11500],
  27: [220, 660, 1100, 3300, 8000, 9750, 11500],
  29: [240, 720, 1200, 3600, 8500, 10250, 12000],
  31: [260, 780, 1300, 3900, 9000, 11000, 12750],
  32: [260, 780, 1300, 3900, 9000, 11000, 12750],
  34: [280, 840, 1500, 4500, 10000, 12000, 14000],
  37: [350, 1050, 1750, 5000, 11000, 13000, 15000],
  39: [500, 1500, 2000, 6000, 14000, 17000, 20000],
};
export const propertyRent = (index:number, level:number) => PROPERTY_RENTS[index]?.[Math.max(0, Math.min(Math.floor(level), MAX_PROPERTY_LEVEL + 1))] ?? 0;
const UPGRADE_COSTS: Readonly<Record<string, number>> = {pink:500,gold:500,teal:1000,blue:1000,green:1500,cyan:1500,purple:2000,slate:2000};
export const propertyUpgradeCost = (index:number, upgrades=0) => upgrades >= 0 ? UPGRADE_COSTS[tiles[index]?.group ?? ''] ?? 0 : 0;
export const groupTiles = (index:number) => {const group=tiles[index]?.group;return group?tiles.flatMap((tile,i)=>tile.price&&tile.group===group&&!isCarCompany(i)&&!isDiceRent(i)?[i]:[]):[]};
export const ownsFullGroup = (owners:Record<number,string>, index:number) => {const owner=owners[index],group=groupTiles(index);return !!owner&&group.length>0&&group.every(i=>owners[i]===owner)};
export const effectivePropertyLevel = (owners:Record<number,string>, levels:Record<number,number>|undefined, index:number) => ownsFullGroup(owners,index)?1+(levels?.[index]||0):0;
export const groupHasMortgage = (mortgaged:number[],index:number) => groupTiles(index).some(i=>mortgaged.includes(i));
export type Loan = {principal:number; totalDue:number; turnsLeft:number};
export type ChanceResult = {id:string; title:string; description:string; amount:number; playerId:string; movement?:'nearestAvailableCompany'};
export type Player = {id:string; name:string; color:string; money:number; position:number; turnsTaken?:number; bot?:boolean; bankrupt?:boolean; jailed?:boolean; jailAttempts?:number; doubles?:number; loan?:Loan; loanUsed?:boolean};
export type Trade = {id?:string; from:string; to:string; give:number[]; take:number[]; giveCash:number; takeCash:number};
export type Game = {code:string; players:Player[]; host:string; started:boolean; turn:number; phase:'lobby'|'roll'|'buy'|'pay'|'auction'|'jackpot'|'jackpotResult'|'chanceResult'|'jail'|'finished'; owners:Record<number,string>; levels?:Record<number,number>; turnSerial?:number; lastUpgradeTurn?:Record<string,number>; mortgaged:number[]; mortgageTurns?:Record<number,number>; dice:number[]; debt?:{amount:number; to?:string; reason:string; kind?:'diamond'|'chance'|'loan'; afterPayment?:'releaseRoll'|'releaseEnd'|'resumeTurn'}; auction?:{tile:number; bid:number; bidder?:string; passed:string[]; seller?:string}; move?:{playerId:string; steps:number; jailTransfer?:boolean; noDice?:boolean; stepMs?:number}; extraTurn?:string; rollSeq?:number; jackpotResult?:{playerId:string; choice:number[]; result:number; payout:number}; chanceResult?:ChanceResult; lastChanceId?:string; trade?:Trade; log:string[]; winner?:string; animationUntil?:number; revision:number};
export const colors=['#ed515b','#35aeeb','#95ca50','#b880e7','#f7b94a','#ec7fa6'];
export const money=(n:number)=>`${n.toLocaleString('en-US')}k`;

// Net capital uses purchase prices; a mortgage and an outstanding loan are liabilities.
export function playerCapital(game: Game, player: Player): number {
  return Object.keys(game.owners).map(Number).filter(i => game.owners[i] === player.id).reduce((total, i) => {
    const price = tiles[i]?.price ?? 0;
    const upgrades = game.levels?.[i] ?? 0;
    return total + price - (game.mortgaged.includes(i) ? Math.floor(price / 2) : 0) + upgrades * propertyUpgradeCost(i);
  }, player.money - (player.loan?.totalDue ?? 0));
}
// Amount obtainable immediately by selling improvements and mortgaging property.
export function liquidFunds(game: Game, player: Player): number {
  return Object.keys(game.owners).map(Number).filter(i => game.owners[i] === player.id && !game.mortgaged.includes(i)).reduce((total, i) =>
    total + Math.floor((tiles[i]?.price ?? 0) / 2) + (game.levels?.[i] ?? 0) * Math.floor(propertyUpgradeCost(i) / 2), player.money);
}
