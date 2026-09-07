import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface Place { name: string; position: [number, number, number] }
export interface LevelData { id: number; scenes: string[]; locations: Place[]; locators: (Place & { kind: number })[]; roads: number[][][]; fences: number[][][] }
export interface Catalog { carNames?:Record<string,string>;levels: number[]; cars: string[]; textures: Record<string,string>; stats: Record<string,number> }
export interface SceneryMaterial {albedo:string;kind:string;detail:string;roughness:number;metalness:number;bump:number;scale:number}
interface MaterialData {scenery?:SceneryMaterial; texture: string; textureUrl?: string; alpha: boolean; blend: number; lit: boolean; translucent: boolean }
interface Primitive { shader: string; attributes: Record<string,[number,number]> }
interface AssetData { collision: [number,number] | null; objects: { name: string; mesh: string; matrix: number[] }[]; meshes: Record<string,Primitive[]>; materials: Record<string,MaterialData> }

export const assetURL=(path:string)=>`${import.meta.env?.BASE_URL??'/'}assets/${path}`;
export async function json<T>(file: string): Promise<T> {
  const response = await fetch(assetURL(file));
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
  return response.json();
}

export class Assets {
  textures = new Map<string,THREE.Texture>();
  materials = new Map<string,THREE.Material>();
  geometries = new Set<THREE.BufferGeometry>();
  private loader = new THREE.TextureLoader();
  private pendingTextures=new Map<string,Promise<void>>();
  surfaceOverrides:Record<string,string>={};
  sceneryMaterials:Record<string,SceneryMaterial>={};sceneryScenes=new Set<string>();
  constructor(public catalog: Catalog) {}

  async load(name: string, vehicle = false) {
    if(vehicle){
      const gltf=await new GLTFLoader().loadAsync(assetURL(`remaster/${name}.glb`));
      const root=(gltf.scene.children[0]??gltf.scene) as THREE.Group;
      root.traverse(object=>{
        if(object.userData.p3dName)object.name=object.userData.p3dName;
        if(object instanceof THREE.Mesh){
          this.geometries.add(object.geometry);
          for(const mat of Array.isArray(object.material)?object.material:[object.material]){
            this.materials.set(mat.uuid,mat);
            for(const value of Object.values(mat))if(value instanceof THREE.Texture){this.textures.set(value.uuid,value);value.anisotropy=16;}
          }
        }
      });
      return {root,collision:null};
    }
    const path=this.sceneryScenes.has(name)?`remaster/scenes/${name}`:name;
    const [meta, response] = await Promise.all([json<AssetData>(`${path}.json`), fetch(assetURL(`${path}.bin`))]);
    if (!response.ok) throw new Error(`Missing geometry: ${name}`);
    const binary = await response.arrayBuffer();
    for(const mat of Object.values(meta.materials)){const url=mat.textureUrl??this.catalog.textures[mat.texture];if(this.sceneryMaterials[url]){mat.scenery=this.sceneryMaterials[url];mat.textureUrl=mat.scenery.albedo;}else if(this.surfaceOverrides[url])mat.textureUrl=this.surfaceOverrides[url];}
    const textures = [...new Set(Object.values(meta.materials).map(m => m.textureUrl ?? this.catalog.textures[m.texture]).filter(Boolean))];
    await Promise.all(textures.map(async url => {
      if (this.textures.has(url)) return;
      if(this.pendingTextures.has(url))return this.pendingTextures.get(url);
      const pending=(async()=>{const texture = await this.loader.loadAsync(assetURL(url));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 16;
      // Pure3D UVs use the lower-left origin; PNG rows start at the top.
      texture.flipY = true;
      this.textures.set(url,texture);})();
      this.pendingTextures.set(url,pending);await pending;
    }));
    const detailMaps=new Map<string,THREE.Texture>();
    await Promise.all([...new Set(Object.values(meta.materials).map(m=>m.scenery?.detail).filter((p):p is string=>!!p))].map(async url=>{
      const key=`detail:${url}`;let texture=this.textures.get(key);if(!texture){texture=await this.loader.loadAsync(assetURL(url));texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(6,6);texture.anisotropy=4;this.textures.set(key,texture);}detailMaps.set(url,texture);
    }));
    const material = (shader: string) => {
      const source = meta.materials[shader];
      const url = source?.textureUrl ?? this.catalog.textures[source?.texture];
      const key = JSON.stringify([source,url,vehicle]);
      if (!this.materials.has(key)) {
        const map=this.textures.get(url);
        const options = {...(map?{map}:{}), vertexColors:!vehicle, side:THREE.DoubleSide,
          alphaTest: source?.alpha || !vehicle && source?.translucent ? 0.4 : 0,
          transparent: vehicle && source?.blend === 1, color:0xffffff};
        this.materials.set(key,vehicle
          ? new THREE.MeshPhysicalMaterial({...options,roughness:source?.blend===1?0.16:0.42,metalness:0.12,clearcoat:0.65,clearcoatRoughness:0.24,envMapIntensity:0.55})
          : new THREE.MeshStandardMaterial({...options,roughness:source?.scenery?.roughness??0.94,metalness:source?.scenery?.metalness??0,envMapIntensity:0.2,...(source?.scenery?.bump?{bumpMap:detailMaps.get(source.scenery.detail),bumpScale:source.scenery.bump}: {})}));
      }
      const mat=this.materials.get(key)!;mat.name=shader;return mat;
    };
    const groups = new Map<string, {geometry: THREE.BufferGeometry; material: THREE.Material; shader: string}[]>();
    for (const [name,primitives] of Object.entries(meta.meshes)) {
      groups.set(name,primitives.map(part => {
        const geometry = new THREE.BufferGeometry();
        for (const [key,[offset,length]] of Object.entries(part.attributes)) {
          if (key === 'indices') geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(binary,offset,length),1));
          else geometry.setAttribute(key,new THREE.BufferAttribute(new Float32Array(binary,offset,length),key==='uv'?2:3));
        }
        if (vehicle && !geometry.getAttribute('normal')) geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        this.geometries.add(geometry);
        return {geometry,material:material(part.shader),shader:part.shader};
      }));
    }
    const root = new THREE.Group(); root.name = name;
    // Batch static geometry by material inside each streaming region.
    const batches = new Map<THREE.Material,THREE.BufferGeometry[]>();
    for (const object of meta.objects) {
      const matrix = new THREE.Matrix4().fromArray(object.matrix);
      const group = new THREE.Group();group.name=object.name;
      for (const part of groups.get(object.mesh) ?? []) {
        if (vehicle) {
          const mesh = new THREE.Mesh(part.geometry,part.material);
          group.add(mesh);
        } else {
          const geometry = part.geometry.clone().applyMatrix4(matrix);
          if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
          const batch=batches.get(part.material) ?? [];batch.push(geometry);batches.set(part.material,batch);
        }
      }
      if (vehicle) {group.applyMatrix4(matrix);root.add(group);}
    }
    for (const [mat,geometries] of batches) {
      const merged=mergeGeometries(geometries);
      geometries.forEach(g=>g.dispose());
      if (merged) {if(!merged.getAttribute('normal'))merged.computeVertexNormals();this.geometries.add(merged);const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
    }
    let collision: THREE.BufferGeometry | null = null;
    if (meta.collision) {
      collision = new THREE.BufferGeometry();
      collision.setAttribute('position',new THREE.BufferAttribute(new Float32Array(binary,...meta.collision),3));
      this.geometries.add(collision);
    }
    return {root,collision};
  }

  dispose() {
    this.geometries.forEach(g=>{g.disposeBoundsTree();g.dispose();});
    this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());
    this.geometries.clear();this.materials.clear();this.textures.clear();
  }
}
