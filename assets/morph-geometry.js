import * as THREE from './vendor/three/three.module.js';

export const PARTICLES = 14000;
const noise=(i,salt)=>{const n=Math.sin(i*127.1+salt*311.7)*43758.5453;return n-Math.floor(n);};

// Sample every side of a solid, so morphs also work from behind.
export function sampleSurface(geometry,count=PARTICLES) {
    const p=geometry.attributes.position.array,c=geometry.attributes.color.array;
    const indices=geometry.index?.array,length=indices?.length??p.length/3;
    const triangles=[];let total=0;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),d=new THREE.Vector3();
    for(let i=0;i<length;i+=3) {
        const ids=indices?[indices[i],indices[i+1],indices[i+2]]:[i,i+1,i+2];
        a.fromArray(p,ids[0]*3);b.fromArray(p,ids[1]*3);d.fromArray(p,ids[2]*3);
        const area=b.sub(a).cross(d.sub(a)).length()/2;
        if(area<1e-12)continue;
        total+=area;triangles.push({ids,total});
    }
    if(!total)throw new Error('Cannot sample an empty surface');
    const samples=[];
    for(let i=0;i<count;i++) {
        const area=(i+.5)/count*total;let lo=0,hi=triangles.length-1;
        while(lo<hi){const mid=(lo+hi)>>1;if(triangles[mid].total<area)lo=mid+1;else hi=mid;}
        const root=Math.sqrt(noise(i,12)),t=noise(i,31),weights=[1-root,root*(1-t),root*t];
        const point=[0,0,0],color=[0,0,0];
        triangles[lo].ids.forEach((id,k)=>{for(let j=0;j<3;j++){point[j]+=p[id*3+j]*weights[k];color[j]+=c[id*3+j]*weights[k];}});
        samples.push({point,color});
    }
    samples.sort((a,b)=>a.point[0]-b.point[0]||a.point[1]-b.point[1]||a.point[2]-b.point[2]);
    return {positions:new Float32Array(samples.flatMap(s=>s.point)),colors:new Float32Array(samples.flatMap(s=>s.color))};
}
