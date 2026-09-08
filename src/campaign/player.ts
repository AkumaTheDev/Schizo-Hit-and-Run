import type * as THREE from 'three';
import type { CarState } from '../physics';
import type { VehicleFootprint } from '../vehicle-collision';
/** What the pursuit and traffic systems need to know about whoever they are chasing. */
export interface Player {state:CarState;onFoot:boolean;vehicle:string;parkedPosition:THREE.Vector3;parkedHeading:number;footprint?:VehicleFootprint}
