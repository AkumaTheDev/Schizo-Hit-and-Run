import * as THREE from 'three';
export const COIN_RULES={poolSize:200,footReach:2.25,carScale:2.25,heightReach:2.25,diamondReach:3,collectSeconds:.4,gravity:21,bounce:.6,launchSpeed:9.5,fadeSeconds:11,lifetime:16,drawDistance:60,spin:3};
export function coinWithinReach(coin:THREE.Vector3,player:THREE.Vector3,inCar:boolean){
  const x=Math.abs(coin.x-player.x),z=Math.abs(coin.z-player.z),scale=inCar?COIN_RULES.carScale:1;
  return x<COIN_RULES.footReach*scale&&z<COIN_RULES.footReach*scale&&Math.abs(coin.y-player.y)<COIN_RULES.heightReach&&x+z<COIN_RULES.diamondReach*scale;
}
export interface Coin {position:THREE.Vector3;velocity:THREE.Vector3;origin:THREE.Vector3;trail:number;age:number;magnet:number;floor:number;active:boolean;collecting:boolean;airborne:boolean;autoCollect:boolean;spin:number}
/** PAL CoinManager 0x25b818/0x25bca8 and loose-coin update 0x25be28. */
export class CoinSimulation {
  readonly coins:Coin[]=[];readonly found=new Set<number>();private accumulated=0;
  constructor(positions:THREE.Vector3[],private random=()=>Math.random()){
    positions.forEach((p,id)=>this.coins.push(this.coin(p,id)));
    for(let i=0;i<COIN_RULES.poolSize;i++){const coin=this.coin(new THREE.Vector3(),-1);coin.active=false;this.coins.push(coin);}
  }
  private coin(position:THREE.Vector3,trail:number):Coin{return {position:position.clone(),origin:position.clone(),velocity:new THREE.Vector3(),trail,age:0,magnet:0,floor:position.y,active:true,collecting:false,airborne:false,autoCollect:false,spin:this.random()*Math.PI};}
  reset(entries:number[]=[]){
    this.found.clear();for(const id of entries)if(Number.isInteger(id)&&id>=0&&id<this.coins.length-COIN_RULES.poolSize)this.found.add(id);
    for(const coin of this.coins){coin.position.copy(coin.origin);coin.active=coin.trail>=0&&!this.found.has(coin.trail);coin.age=coin.magnet=0;coin.collecting=coin.airborne=false;coin.velocity.set(0,0,0);}
    this.accumulated=0;
  }
  drop(amount:number,position:THREE.Vector3,floor:number,autoCollect=false){
    let overflow=Math.max(0,Math.floor(amount));
    for(const coin of this.coins){if(!overflow)break;if(coin.trail>=0||coin.active)continue;
      coin.active=coin.airborne=true;coin.collecting=false;coin.autoCollect=autoCollect;coin.position.copy(position);coin.position.y=Math.max(position.y,floor+.5);coin.floor=floor;
      coin.velocity.set(this.random()*2-1,this.random(),this.random()*2-1).normalize();coin.velocity.y+=1.1;coin.velocity.multiplyScalar(COIN_RULES.launchSpeed);
      coin.age=coin.magnet=0;overflow--;
    }
    // The native manager credits coins immediately if its loose-coin pool is full.
    return overflow;
  }
  update(dt:number,player:THREE.Vector3,inCar:boolean,collect=true){
    this.accumulated+=Math.min(dt,.1);let earned=0;
    while(this.accumulated>=1/60){this.accumulated-=1/60;
      for(const coin of this.coins){if(!coin.active)continue;coin.age+=1/60;coin.spin+=COIN_RULES.spin/60;
        if(coin.collecting){
          if(!collect)continue;
          coin.magnet+=1/60;
          if(coin.magnet>COIN_RULES.collectSeconds){coin.active=false;earned++;if(coin.trail>=0)this.found.add(coin.trail);continue;}
          coin.position.lerp(player,coin.magnet);coin.position.y+=(1-coin.magnet)*.4;continue;
        }
        if(collect&&!coin.airborne&&coinWithinReach(coin.position,player,inCar)){coin.collecting=true;coin.magnet=0;continue;}
        if(coin.trail<0){
          if(coin.age>COIN_RULES.lifetime){coin.active=false;continue;}
          if(coin.velocity.lengthSq()>0){
            coin.position.addScaledVector(coin.velocity,1/60);coin.velocity.multiplyScalar(Math.exp(-.2/60));coin.velocity.y-=COIN_RULES.gravity/60;
            if(coin.position.y<coin.floor){coin.position.y=coin.floor;coin.velocity.y=Math.abs(coin.velocity.y)*COIN_RULES.bounce;coin.airborne=false;if(coin.velocity.y<.1)coin.velocity.set(0,0,0);if(coin.autoCollect&&collect){coin.collecting=true;coin.magnet=0;}}
          }
        }
      }
    }
    return earned;
  }
}
