import * as THREE from './vendor/three/three.module.js';
import { SVGLoader } from './vendor/three/SVGLoader.js';
import { sampleSurface } from './morph-geometry.js';
export { PARTICLES } from './morph-geometry.js';

export const LOGOS = [
    {id:'tau',name:'Tel Aviv University',file:'tau_logo.png'},
    {id:'marz',name:'MARZ',file:'marz_logo.jpg'},
    {id:'ibm',name:'IBM Research',file:'ibm_logo.svg'},
    {id:'cisco',name:'Cisco',file:'cisco_logo.svg'}
];

async function vectorGeometry(url) {
    const data=await new SVGLoader().loadAsync(url),parts=[],bounds=new THREE.Box3(),seen=new Set();
    for(const path of data.paths) {
        if(path.userData?.style?.fill==='none')continue;
        for(const shape of SVGLoader.createShapes(path)) {
            const flat=new THREE.ShapeGeometry(shape,32);flat.computeBoundingBox();
            // Cisco's SVG intentionally overprints three mirrored bridge bars.
            // Keep a single solid for each coincident shape in the 3D model.
            const key=[...flat.boundingBox.min.toArray(),...flat.boundingBox.max.toArray(),path.color.getHex()].map(v=>Math.round(v*1000)).join(',');
            if(seen.has(key)){flat.dispose();continue;}seen.add(key);
            bounds.union(flat.boundingBox);flat.dispose();
            const color=path.color.clone();
            if(Math.max(color.r,color.g,color.b)<.03)color.set('#242529');
            parts.push({shape,color});
        }
    }
    const size=bounds.getSize(new THREE.Vector3()),scale=Math.min(5.5/size.x,3.7/size.y);
    const positions=[],normals=[],colors=[];
    for(const {shape,color} of parts) {
        const g=new THREE.ExtrudeGeometry(shape,{depth:.30/scale,curveSegments:32,steps:1,bevelEnabled:true,bevelSize:.009/scale,bevelThickness:.018/scale,bevelSegments:3});
        // Two sign flips preserve winding and outward normals.
        g.scale(scale,-scale,-scale);
        const p=g.attributes.position.array,n=g.attributes.normal.array;
        for(let i=0;i<p.length;i+=9) {
            const corners=[0,3,6].map(offset=>[p[i+offset],p[i+offset+1],p[i+offset+2]].map(v=>Math.round(v*1e6)).join(','));
            if(new Set(corners).size<3)continue;
            for(let j=0;j<9;j++){positions.push(p[i+j]);normals.push(n[i+j]);}
            for(let j=0;j<3;j++)colors.push(color.r,color.g,color.b);
        }
        g.dispose();
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    return geometry;
}

async function rasterGeometry(logo,url) {
    const image=new Image();image.src=url;await image.decode();
    const canvas=document.createElement('canvas'),ratio=600/Math.max(image.naturalWidth,image.naturalHeight);
    const w=canvas.width=Math.round(image.naturalWidth*ratio),h=canvas.height=Math.round(image.naturalHeight*ratio);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
    const pixels=ctx.getImageData(0,0,w,h).data,mask=new Uint8Array(w*h);
    let minX=w,maxX=0,minY=h,maxY=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const i=(y*w+x)*4,[r,g,b,a]=pixels.subarray(i,i+4);
        const foreground=logo.id==='marz'?!(r>100&&r>g*1.5&&r>b*1.3):Math.min(r,g,b)<215;
        if(a<120||!foreground)continue;
        mask[y*w+x]=logo.id==='marz'&&r+g+b>440?2:1;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    }
    if(minX===w)throw new Error(`Empty logo: ${logo.id}`);
    // Resolve diagonal-only contacts so solids cannot meet at only one vertex.
    for(let pass=0;pass<4;pass++) {
        let changed=false;
        for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++) {
            const a=y*w+x,b=a+1,c=a+w,d=c+1;
            if(mask[a]&&mask[d]&&!mask[b]&&!mask[c]){mask[b]=mask[a];changed=true;}
            else if(mask[b]&&mask[c]&&!mask[a]&&!mask[d]){mask[a]=mask[b];changed=true;}
        }
        if(!changed)break;
    }
    const scale=Math.min(5.5/(maxX-minX+1),3.7/(maxY-minY+1));
    const cx=(minX+maxX+1)/2,cy=(minY+maxY+1)/2,halfDepth=.16;
    const palette=[new THREE.Color('#242529'),new THREE.Color('#f7f4ed')];
    const positions=[],colors=[],indices=[],cache=new Map();
    const at=(x,y)=>x<0||y<0||x>=w||y>=h?0:mask[y*w+x];
    function vertex(x,y,back=false) {
        const key=(y*(w+1)+x)*2+Number(back);if(cache.has(key))return cache.get(key);
        let r=0,g=0,b=0,count=0;
        for(const [px,py] of [[x,y],[x-1,y],[x,y-1],[x-1,y-1]]) {
            const value=at(px,py);if(!value)continue;
            const c=palette[value-1];r+=c.r;g+=c.g;b+=c.b;count++;
        }
        const z=halfDepth-(count<4?Math.min(.012,scale):0),i=positions.length/3;
        positions.push((x-cx)*scale,(cy-y)*scale,back?-z:z);
        colors.push(r/count,g/count,b/count);cache.set(key,i);return i;
    }
    function wall(a,b,c,d){indices.push(a,b,c,a,c,d);}
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
        if(!at(x,y))continue;
        const tl=vertex(x,y),tr=vertex(x+1,y),bl=vertex(x,y+1),br=vertex(x+1,y+1);
        const btl=vertex(x,y,true),btr=vertex(x+1,y,true),bbl=vertex(x,y+1,true),bbr=vertex(x+1,y+1,true);
        indices.push(bl,br,tr,bl,tr,tl,bbr,bbl,btl,bbr,btl,btr);
        if(!at(x-1,y))wall(bl,tl,btl,bbl);
        if(!at(x+1,y))wall(tr,br,bbr,btr);
        if(!at(x,y-1))wall(tl,tr,btr,btl);
        if(!at(x,y+1))wall(br,bl,bbl,bbr);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export async function createLogoAsset(logo) {
    const url=new URL(`./logos/${logo.file}`,import.meta.url).href;
    const geometry=logo.file.endsWith('.svg')?await vectorGeometry(url):await rasterGeometry(logo,url);
    geometry.center();
    const material=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.16,roughness:.38,transparent:true});
    const mesh=new THREE.Mesh(geometry,material);mesh.name=logo.id;
    return {...logo,mesh,...sampleSurface(geometry)};
}
