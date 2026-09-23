import * as THREE from './vendor/three/three.module.js';
import { sampleSurface } from './morph-geometry.js';

export const OBJECTS = [
    { id: 'paper', name: 'Paper', shortName: 'Paper', kind: 'object', source: './objects/paper.svg' }
];

export const PAPER_TITLES = [
    { id: 'attention-triangle', name: 'The Attention Triangle in Audio-Video Models', shortName: 'The Attention Triangle', nameLines: ['The Attention', 'Triangle'], image: './scroll-thumbnails/attention-triangle.jpg', video: './AttentionTriangle_teaser.mp4', lines: ['The Attention', 'Triangle in', 'Audio-Video Models'] },
    { id: 'linear-semantics', name: 'Video Analysis and Generation via a Semantic Progress Function', shortName: 'Semantic Progress Function', nameLines: ['Semantic', 'Progress Function'], image: './scroll-thumbnails/linear-semantics.jpg', video: './LinearSemantics_teaser.mp4', lines: ['Video Analysis', 'and Generation', 'via a Semantic', 'Progress Function'] },
    { id: 'sync-lora', name: 'In-Context Sync-LoRA for Portrait Video Editing', shortName: 'Sync-LoRA', nameLines: ['Sync-LoRA'], image: './scroll-thumbnails/sync-lora.jpg', video: './SyncLoRA_teaser.mp4', lines: ['In-Context', 'Sync-LoRA for', 'Portrait Video', 'Editing'] },
    { id: 'neuralsvg', name: 'NeuralSVG: An Implicit Representation for Text-to-Vector Generation', shortName: 'NeuralSVG', nameLines: ['NeuralSVG'], image: './NeuralSVG_teaser.png', lines: ['NeuralSVG:', 'An Implicit', 'Representation for', 'Text-to-Vector', 'Generation'] }
];

export const PAPER_VERSIONS = [
    { id: 'full', name: 'Full title' },
    { id: 'name', name: 'Name only' },
    { id: 'illustrated', name: 'Name + picture' }
];

async function inscriptionTexture(paper,version) {
    let picture;
    if(version==='illustrated') {
        picture=new Image();picture.src=new URL(paper.image,import.meta.url).href;
        await picture.decode();
    }
    const canvas=document.createElement('canvas');
    canvas.width=1024;canvas.height=1536;
    const ctx=canvas.getContext('2d');
    // White preserves the parchment's vertex colors; the ink is printed onto
    // the actual curved surface, rather than hovering in front of the model.
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#39271a';
    const lines=version==='full'?paper.lines:paper.nameLines;
    let size=version==='full'?92:version==='name'?132:112;
    do {ctx.font=`600 ${size}px Georgia, "Times New Roman", serif`;if(lines.every(line=>ctx.measureText(line).width<=790))break;size-=2;} while(size>50);
    const lineHeight=size*1.22;
    // Preserve the complete thumbnail, including wide multi-panel figures.
    const pictureWidth=picture?Math.min(824,470*picture.naturalWidth/picture.naturalHeight):0;
    const pictureHeight=picture?pictureWidth*picture.naturalHeight/picture.naturalWidth:0;
    const blockHeight=lines.length*lineHeight+(picture?56+pictureHeight:0);
    const top=768-blockHeight/2;
    lines.forEach((line,index)=>ctx.fillText(line,512,top+lineHeight*(index+.5)));
    if(picture) {
        const x=512-pictureWidth/2,y=top+lines.length*lineHeight+56;
        ctx.fillStyle='#fff';ctx.fillRect(x-12,y-12,pictureWidth+24,pictureHeight+24);
        ctx.drawImage(picture,x,y,pictureWidth,pictureHeight);
        ctx.strokeStyle='#7d5b35';ctx.lineWidth=2;
        ctx.strokeRect(x-12,y-12,pictureWidth+24,pictureHeight+24);
    }
    const edge=blockHeight/2+50;
    ctx.strokeStyle='#7d5b35';ctx.lineWidth=2;
    for(const y of [768-edge,768+edge]){ctx.beginPath();ctx.moveTo(360,y);ctx.lineTo(664,y);ctx.stroke();}
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
    texture.name=`${paper.shortName} — ${version}`;
    let video=null,lastPaint=-Infinity,lastVideoTime=-1;
    if(picture&&paper.video) {
        video=document.createElement('video');
        video.muted=true;video.defaultMuted=true;video.loop=true;video.playsInline=true;
        video.setAttribute('muted','');video.setAttribute('playsinline','');
        video.preload='none';video.poster=picture.src;
        video.dataset.scrollVideo=paper.id;
        video.src=new URL(paper.video,import.meta.url).href;
    }
    return {
        texture,video,
        paintVideo(now) {
            if(!video||video.readyState<2||video.currentTime===lastVideoTime||now-lastPaint<1000/30)return;
            ctx.drawImage(video,512-pictureWidth/2,top+lines.length*lineHeight+56,pictureWidth,pictureHeight);
            texture.needsUpdate=true;lastPaint=now;lastVideoTime=video.currentTime;
        }
    };
}

const clamp = value => Math.max(0, Math.min(1, value));
const fract = value => value - Math.floor(value);
const hash = (x,y=0) => fract(Math.sin(x*127.1+y*311.7)*43758.5453123);
function noise(x,y=0) {
    const ix=Math.floor(x), iy=Math.floor(y);
    let u=fract(x),v=fract(y); u=u*u*(3-2*u); v=v*v*(3-2*v);
    return (hash(ix,iy)*(1-u)+hash(ix+1,iy)*u)*(1-v)
        +(hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u)*v;
}
const TURN=Math.PI*2.24;
const ROTATION=new THREE.Matrix4();

// One continuous sheet, with both ends wound into a tapering spiral. The back
// is offset along the surface normal so the rolls have real paper thickness.
function surface(u,v) {
    const edgeV=clamp(v);
    const tears=(side) => (noise(edgeV*93,side)-.5)*.035+(noise(edgeV*31,side+4)-.5)*.055;
    const notch=(at,width,depth) => Math.exp(-(((edgeV-at)/width)**2))*depth;
    const left=-1.34+tears(3)+notch(.37,.010,.080)+notch(.70,.016,.068);
    const right=1.34+tears(17)-notch(.48,.012,.072)-notch(.79,.013,.060);
    const x=left+(right-left)*u;
    const sag=.035*(1-(2*u-1)**2);
    let y,z;
    if(v<.17||v>.83) {
        const top=v>.83;
        const t=top ? (v-.83)/.17 : (.17-v)/.17;
        const theta=t*TURN;
        const radius=.205-.040*t;
        y=(top ? 1 : -1)*(1.56+radius*Math.sin(theta))-sag;
        z=.205-radius*Math.cos(theta);
    } else {
        const t=(v-.17)/.66;
        y=-1.56+3.12*t-sag;
        z=(Math.sin(t*Math.PI)*(.024*Math.sin(u*5.8)+.018*Math.sin(t*11+u*3)))
            +.025*Math.sin(u*Math.PI)*Math.sin(t*Math.PI);
    }
    return new THREE.Vector3(x,y,z).applyMatrix4(ROTATION);
}

function parchmentColor(u,v,back=false) {
    const grain=noise(u*23,v*35)*.35+noise(u*127,v*163)*.10+noise(u*5,v*8)*.55;
    const mottles=noise(u*17+4,v*20+9);
    const edge=Math.min(u,1-u);
    const edgeBand=.047+(noise(v*39,3)-.5)*.025;
    const scorch=Math.exp(-edge/edgeBand);
    const paperEnds=Math.exp(-Math.min(v,1-v)/.009)*.32;
    const stain=clamp((mottles-.53)*1.65)*.23;
    const dark=clamp(scorch*.95+paperEnds+stain);
    const light=new THREE.Color().setRGB(.83+grain*.10,.69+grain*.11,.47+grain*.14,THREE.SRGBColorSpace);
    const brown=new THREE.Color('#54240e');
    light.lerp(brown,dark);
    if(back) light.multiplyScalar(.83);
    return light;
}

export async function createScrollAsset(descriptor=OBJECTS[0],{mediaHost,onPlaybackChange=()=>{}}={}) {
    const columns=112,rows=240;
    const frontCount=(columns+1)*(rows+1);
    const positions=[],colors=[],uvs=[],indices=[];
    const thickness=.014;
    const normal=new THREE.Vector3();
    const color=new THREE.Color();
    for(const back of [false,true]) {
        for(let j=0;j<=rows;j++) for(let i=0;i<=columns;i++) {
            const u=i/columns,v=j/rows;
            const p=surface(u,v);
            if(back) {
                const du=surface(u+.0001,v).sub(surface(u-.0001,v));
                const dv=surface(u,v+.0001).sub(surface(u,v-.0001));
                normal.crossVectors(du,dv).normalize();
                p.addScaledVector(normal,-thickness);
            }
            positions.push(p.x,p.y,p.z);
            // The back samples the blank texture corner, preserving its
            // parchment color while keeping every inscription on the front.
            uvs.push(back?0:u,back?0:v);
            color.copy(parchmentColor(u,v,back));
            colors.push(color.r,color.g,color.b);
        }
    }
    for(let j=0;j<rows;j++) for(let i=0;i<columns;i++) {
        const a=j*(columns+1)+i,b=a+1,c=a+columns+1,d=c+1;
        indices.push(a,b,d,a,d,c);
        indices.push(a+frontCount,c+frontCount,d+frontCount,a+frontCount,d+frontCount,b+frontCount);
    }
    // Close all four exposed edges, keeping their normals independent of the
    // broad faces so even the spiral cross-sections remain visibly thin.
    const boundary=[];
    for(let i=0;i<=columns;i++) boundary.push(i);
    for(let j=1;j<=rows;j++) boundary.push(j*(columns+1)+columns);
    for(let i=columns-1;i>=0;i--) boundary.push(rows*(columns+1)+i);
    for(let j=rows-1;j>0;j--) boundary.push(j*(columns+1));
    boundary.forEach((a,i)=>{
        const b=boundary[(i+1)%boundary.length],start=positions.length/3;
        for(const index of [a,a+frontCount,b+frontCount,b]) {
            positions.push(...positions.slice(index*3,index*3+3));
            colors.push(...colors.slice(index*3,index*3+3).map(c=>c*.65));
            uvs.push(0,0);
        }
        indices.push(start,start+1,start+2,start,start+2,start+3);
    });
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const center=geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x,-center.y,-center.z);
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.91,metalness:0,transparent:true});
    material.color.setScalar(.65);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=descriptor.id;
    const inscriptions=new Map();
    let activeInscription=null,playbackEnabled=false,playbackBlocked=false;
    function reconcilePlayback() {
        const video=activeInscription?.video;
        playbackBlocked=false;
        if(video) {
            if(playbackEnabled) video.play().catch(error=>{
                if(activeInscription?.video!==video||!playbackEnabled||error.name==='AbortError')return;
                playbackBlocked=true;onPlaybackChange();
            });
            else video.pause();
        }
        onPlaybackChange();
    }
    let inscriptionRevision=0;
    async function setTitle(id,version='full') {
        const revision=++inscriptionRevision;
        const paper=PAPER_TITLES.find(paper=>paper.id===id);
        version=PAPER_VERSIONS.some(style=>style.id===version)?version:'full';
        const key=`${id}:${version}`;
        if(paper&&!inscriptions.has(key)) {
            const pending=inscriptionTexture(paper,version).then(inscription=>{
                if(inscription.video) {
                    mediaHost?.append(inscription.video);
                    for(const event of ['playing','pause','loadeddata','waiting','error']) {
                        inscription.video.addEventListener(event,()=>{if(activeInscription===inscription)onPlaybackChange();});
                    }
                }
                return inscription;
            }).catch(error=>{inscriptions.delete(key);throw error;});
            inscriptions.set(key,pending);
        }
        const inscription=paper?await inscriptions.get(key):null;
        // A slow picture decode must never overwrite a newer paper or style.
        if(revision!==inscriptionRevision)return false;
        if(activeInscription!==inscription)activeInscription?.video?.pause();
        activeInscription=inscription;
        const map=inscription?.texture||null;
        if(Boolean(material.map)!==Boolean(map))material.needsUpdate=true;
        material.map=map;
        reconcilePlayback();
        return true;
    }

    return {
        ...descriptor,mesh,setTitle,...sampleSurface(geometry),
        setPlayback(enabled,retry=false) {
            if(playbackEnabled===enabled&&!retry)return;
            playbackEnabled=enabled;reconcilePlayback();
        },
        updateVideoFrame(now) { activeInscription?.paintVideo(now); },
        get videoState() {
            const video=activeInscription?.video;
            if(!video)return 'none';
            if(video.error)return 'error';
            if(playbackBlocked)return 'blocked';
            if(video.paused)return 'paused';
            return video.readyState<2?'loading':'playing';
        },
        get videoPlaying() { const video=activeInscription?.video;return !!video&&!video.paused&&!video.ended; }
    };
}
