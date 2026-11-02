// Corner squares are wider than the nine properties on each side.
const edgePosition=(step:number)=>{const point=(n:number)=>n===0?7.1:n===10?92.9:14.2+(n-.5)*(71.6/9);const a=Math.floor(step);const b=Math.min(10,a+1);return point(a)+(point(b)-point(a))*(step-a)};
export const coords=(position:number)=>{const i=((position%40)+40)%40;if(i<=10)return {x:edgePosition(i),y:7.1};if(i<=20)return{x:92.9,y:edgePosition(i-10)};if(i<=30)return{x:100-edgePosition(i-20),y:92.9};return{x:7.1,y:100-edgePosition(i-30)}};
export const jailTransferPoint=(from:number,to:number,progress:number)=>{const start=coords(from),end=coords(to);if(progress<=0)return start;if(progress>=1)return end;return {x:start.x+(end.x-start.x)*progress,y:start.y+(end.y-start.y)*progress}};
