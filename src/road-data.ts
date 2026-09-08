export type RoadPoint=[number,number,number];
export interface RoadNavigation {
  roads:{name:string;start:string;end:string;maxCars:number;speedKmh:number;intelligence:number;shortcut:boolean;segments:number[]}[];
  segments:{name:string;road:number;lanes:number;shoulder:boolean;corners:RoadPoint[];next:number}[];
  junctions:{name:string;position:RoadPoint;radius:number;behavior:number}[];
}
