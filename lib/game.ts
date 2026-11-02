export const DICE_ROLL_MS = 480;
export const TOKEN_STEP_MS = 240;
export type Tile = { name: string; price?: number; kind?: 'chance' | 'tax' | 'bonus' | 'jail' | 'start' | 'jackpot'; group?: string };
export const tiles: Tile[] = [
  {name:'Старт',kind:'start'}, {name:'Chanel',price:600,group:'pink'}, {name:'Шанс',kind:'chance'}, {name:'Hugo Boss',price:600,group:'pink'}, {name:'Деньги',kind:'tax'}, {name:'Mercedes-Benz',price:2000,group:'red'}, {name:'Adidas',price:1000,group:'gold'}, {name:'Шанс',kind:'chance'}, {name:'Puma',price:1000,group:'gold'}, {name:'Lacoste',price:1200,group:'gold'},
  {name:'Тюрьма',kind:'jail'}, {name:'X',price:1400,group:'teal'}, {name:'Rockstar Games',price:1500,group:'brown'}, {name:'Instagram',price:1400,group:'teal'}, {name:'Telegram',price:1600,group:'teal'}, {name:'Audi',price:2000,group:'red'}, {name:'Coca-Cola',price:1800,group:'blue'}, {name:'Шанс',kind:'chance'}, {name:'Pepsi',price:1800,group:'blue'}, {name:'Fanta',price:2000,group:'blue'},
  {name:'Джекпот',kind:'jackpot'}, {name:'American Airlines',price:2200,group:'green'}, {name:'Шанс',kind:'chance'}, {name:'Lufthansa',price:2200,group:'green'}, {name:'British Airways',price:2400,group:'green'}, {name:'Ford',price:2000,group:'red'}, {name:"McDonald's",price:2600,group:'cyan'}, {name:'Burger King',price:2600,group:'cyan'}, {name:'Rovio',price:1500,group:'brown'}, {name:'KFC',price:2800,group:'cyan'},
  {name:'Полиция',kind:'jail'}, {name:'Holiday Inn',price:3000,group:'purple'}, {name:'Radisson',price:3000,group:'purple'}, {name:'Шанс',kind:'chance'}, {name:'Novotel',price:3200,group:'purple'}, {name:'Land Rover',price:2000,group:'red'}, {name:'Бриллиант',kind:'bonus'}, {name:'Apple',price:3500,group:'slate'}, {name:'Шанс',kind:'chance'}, {name:'Nokia',price:4000,group:'slate'},
];
export const MAX_PROPERTY_LEVEL = 5;
export const MORTGAGE_TURNS = 15;
export const JACKPOT_BET = 1000;
export const JACKPOT_PAYOUTS:Record<number,number> = {1:5000,2:2000,3:1000};
export const CAR_COMPANIES = [5,15,25,35] as const;
export const isCarCompany = (i:number) => (CAR_COMPANIES as readonly number[]).includes(i);
export const carRent = (owners:Record<number,string>, i:number) => {const owner=owners[i];if(!owner)return 250;const count=CAR_COMPANIES.filter(index=>owners[index]===owner).length;return [250,500,1000,2000][Math.max(0,count-1)]};
export const isDiceRent = (i:number) => i === 12 || i === 28;
export const diceRentFactor = (owners:Record<number,string>, i:number) => owners[i] && owners[12] === owners[i] && owners[28] === owners[i] ? 250 : 100;
export const propertyRent = (price:number, level:number) => Math.round(price * .2 * ([1,2,3,4.5,6,8,10][Math.max(0,Math.min(level,6))]) / 10) * 10;
export const propertyUpgradeCost = (price:number, upgrades=0) => Math.ceil(price * (.4 + upgrades * .15));
export const groupTiles = (index:number) => {const group=tiles[index]?.group;return group?tiles.flatMap((tile,i)=>tile.price&&tile.group===group&&!isCarCompany(i)&&!isDiceRent(i)?[i]:[]):[]};
export const ownsFullGroup = (owners:Record<number,string>, index:number) => {const owner=owners[index],group=groupTiles(index);return !!owner&&group.length>0&&group.every(i=>owners[i]===owner)};
export const effectivePropertyLevel = (owners:Record<number,string>, levels:Record<number,number>|undefined, index:number) => ownsFullGroup(owners,index)?1+(levels?.[index]||0):0;
export const groupHasMortgage = (mortgaged:number[],index:number) => groupTiles(index).some(i=>mortgaged.includes(i));
export type Player = {id:string; name:string; color:string; money:number; position:number; bot?:boolean; bankrupt?:boolean; jailed?:boolean; jailAttempts?:number; doubles?:number};
export type Trade = {id?:string; from:string; to:string; give:number[]; take:number[]; giveCash:number; takeCash:number};
export type Game = {code:string; players:Player[]; host:string; started:boolean; turn:number; phase:'lobby'|'roll'|'buy'|'pay'|'auction'|'jackpot'|'jackpotResult'|'chanceResult'|'jail'|'finished'; owners:Record<number,string>; levels?:Record<number,number>; turnSerial?:number; lastUpgradeTurn?:Record<string,number>; mortgaged:number[]; mortgageTurns?:Record<number,number>; dice:number[]; debt?:{amount:number; to?:string; reason:string; afterPayment?:'releaseRoll'|'releaseEnd'}; auction?:{tile:number; bid:number; bidder?:string; passed:string[]; seller?:string}; move?:{playerId:string; steps:number; jailTransfer?:boolean; stepMs?:number}; extraTurn?:string; rollSeq?:number; jackpotResult?:{playerId:string; choice:number[]; result:number; payout:number}; trade?:Trade; log:string[]; winner?:string; animationUntil?:number; revision:number};
export const colors=['#ed515b','#35aeeb','#95ca50','#b880e7','#f7b94a','#ec7fa6'];
export const money=(n:number)=>`${n.toLocaleString('en-US')}k`;
