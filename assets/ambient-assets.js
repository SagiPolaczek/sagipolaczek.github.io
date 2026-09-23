import * as THREE from './vendor/three/three.module.js';
import { LOGOS, PARTICLES, createLogoAsset } from './career-models.js';
import { OBJECTS, PAPER_TITLES, createScrollAsset } from './paper-scroll.js';
import { timelineAnchors, timelineBlend, cursorBlend } from './ambient-timeline.js?v=2';

const host=document.querySelector('[data-ambient-assets]');
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const ease=v=>{v=clamp(v);return v*v*(3-2*v);};
const HOVER_DURATION=520;
const SPIN_SECONDS=36;

async function mountBackground(){
    if(!host)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    // Touch devices and narrow layouts select assets through scrolling only.
    const scrollOnly=matchMedia('(hover: none), (pointer: coarse), (max-width: 700px)');
    const canvas=host.querySelector('canvas'),mediaHost=host.querySelector('.ambient-assets__media');
    const motionButton=document.querySelector('.ambient-motion-toggle');
    const resolve=source=>({id:source.dataset.logoMorph,title:source.dataset.paperTitle||'',key:source.dataset.logoMorph==='paper'?`paper:${source.dataset.paperTitle}`:source.dataset.logoMorph});
    const entries=[...document.querySelectorAll('.tl-entry')].map(entry=>({entry,source:entry.querySelector('[data-logo-morph]')})).filter(item=>item.source).map(item=>({...item,selection:resolve(item.source)}));
    const sequence=[{id:'tau',title:'',key:'tau'},...entries.map(item=>item.selection)];
    // Keep each printed paper ready to resolve from its particle transition.
    const careerLogos=[...LOGOS,{id:'coming-soon',name:'Coming soon',file:'coming-soon.svg'}];
    // The homepage only loads the career assets represented in its timeline.
    const descriptors=[...careerLogos.filter(logo=>sequence.some(item=>item.id===logo.id)).map(logo=>({...logo,key:logo.id,title:''})),...PAPER_TITLES.map(paper=>({...OBJECTS[0],key:`paper:${paper.id}`,title:paper.id}))];
    const indexFor=selection=>descriptors.findIndex(asset=>asset.key===selection.key);
    let renderer,scene,camera,group,points,assets;
    let target=0,from=0,to=0,blendAmount=0,mode='scroll',returnMode='scroll',requestedKey=null;
    let userPaused=false,frame=0,lastFrame=0,transition=false,started=0;
    let hoveredItem=null,focusedItem=null,pointerPosition=null;
    let current,currentColors,starts,startColors,meshStarts,startPointOpacity=0;
    let width=innerWidth,height=innerHeight,worldHeight=12*height/width,layoutDirty=true;
    let scale=1,spinAngle=0,hudAt=0,anchors=[0],cursorAnchors=[0],blendSignature='';
    const cursor={x:0,y:0},smooth={x:0,y:0};
    const stopped=()=>userPaused||reduced.matches;
    function syncVideo(){
        assets?.forEach((asset,i)=>asset.setPlayback?.(i===target&&asset.mesh.material.opacity>.2&&!stopped()&&!document.hidden&&!!renderer));
    }
    function refreshMotionButton(){
        const paused=stopped();motionButton.textContent=reduced.matches?'Background motion off':paused?'Resume background motion':'Pause background motion';
        motionButton.setAttribute('aria-pressed',String(paused));
        motionButton.setAttribute('aria-label',reduced.matches?'Background motion disabled by reduced motion preference':paused?'Resume background motion':'Pause background motion');
        motionButton.disabled=reduced.matches;host.dataset.motion=paused?'paused':'playing';
    }
    function metadata(){
        const selected=descriptors[target];host.dataset.asset=selected.id;host.dataset.paperTitle=selected.title;
        host.dataset.mode=mode;host.dataset.from=descriptors[from].key;host.dataset.to=descriptors[to].key;host.dataset.progress=blendAmount.toFixed(4);
    }
    function measureTimeline(){
        const centers=entries.map(({entry})=>{const r=entry.getBoundingClientRect();return scrollY+r.top+r.height*.5;});
        anchors=timelineAnchors(centers,height,Math.max(0,document.documentElement.scrollHeight-height));
        const header=document.querySelector('header')?.getBoundingClientRect();
        const heroCenter=header?scrollY+header.top+header.height*.5:0;
        cursorAnchors=[Math.min(heroCenter,(centers[0]??1)-1),...centers];
        blendSignature='';wake();
    }
    function writeParticles(a,b,p,bloom){
        for(let i=0;i<PARTICLES;i++){
            const k=i*3,phase=i*2.399963;
            for(let j=0;j<3;j++){current[k+j]=a.positions[k+j]+(b.positions[k+j]-a.positions[k+j])*p;currentColors[k+j]=a.colors[k+j]+(b.colors[k+j]-a.colors[k+j])*p;}
            current[k]+=Math.sin(phase)*bloom*.55;current[k+1]+=Math.cos(phase)*bloom*.4;current[k+2]+=Math.sin(phase*.7)*bloom*.8;
        }
        points.geometry.attributes.position.needsUpdate=true;points.geometry.attributes.color.needsUpdate=true;
    }
    function setMeshOpacity(asset,opacity){asset.mesh.material.opacity=opacity;asset.mesh.visible=opacity>.001;asset.mesh.material.depthWrite=opacity>.95;}
    function applyDrivenBlend(driver=mode){
        if(!assets)return;
        const state=driver==='cursor'&&pointerPosition&&!scrollOnly.matches
            ?cursorBlend(scrollY+pointerPosition.y,cursorAnchors):timelineBlend(scrollY,anchors);
        const nextFrom=indexFor(sequence[state.from]),nextTo=indexFor(sequence[state.to]);
        let progress=stopped()?(state.progress>=.5?1:0):ease(state.progress);
        if(nextFrom===nextTo)progress=0;
        const signature=`${driver}:${nextFrom}:${nextTo}:${progress.toFixed(5)}`;
        if(signature===blendSignature)return;
        blendSignature=signature;from=nextFrom;to=nextTo;blendAmount=progress;
        target=progress<.5?from:to;
        const a=assets[from],b=assets[to];
        assets.forEach(asset=>{setMeshOpacity(asset,0);asset.mesh.renderOrder=0;});
        if(from===to){setMeshOpacity(a,1);points.material.opacity=0;points.visible=false;current.set(a.positions);currentColors.set(a.colors);}
        else{
            // Papers also dissolve into particles; a texture crossfade alone
            // hid the transition entirely when two papers shared a silhouette.
            writeParticles(a,b,progress,Math.sin(Math.PI*progress));
            setMeshOpacity(a,1-ease(progress/.32));setMeshOpacity(b,ease((progress-.68)/.32));
            points.material.opacity=ease(progress/.16)*(1-ease((progress-.84)/.16));points.visible=points.material.opacity>.001;
        }
        host.dataset.timelineFrom=String(state.from);host.dataset.timelineTo=String(state.to);
        host.dataset.morphing=String(from!==to&&progress>0&&progress<1);metadata();syncVideo();
        if(stopped())layoutDirty=true;
    }
    function select(selection){
        if(scrollOnly.matches)return;
        const index=indexFor(selection);if(index<0)return;
        if(mode==='hover'&&requestedKey===selection.key)return;
        requestedKey=selection.key;mode='hover';host.dataset.engaged='true';blendSignature='';
        if(!assets){target=index;return;}
        target=index;from=index;to=index;blendAmount=0;metadata();
        startTransition();
    }
    function startTransition(){
        starts.set(current);startColors.set(currentColors);meshStarts=assets.map(a=>a.mesh.material.opacity);startPointOpacity=points.material.opacity;
        started=performance.now();transition=true;
        if(stopped()){layoutDirty=true;updateHoverTransition(started+HOVER_DURATION);}
        syncVideo();wake();
    }
    function resumeDriven(nextMode='scroll'){
        host.dataset.engaged='false';
        if(mode===nextMode){wake();return;}
        returnMode=nextMode;
        if(mode==='return'){wake();return;}
        requestedKey=null;blendSignature='';
        if(!assets){mode=nextMode;return;}
        mode='return';startTransition();
    }
    function updateHoverTransition(now){
        if(!transition)return;
        const returning=mode==='return';
        // Track the live cursor/scroll destination throughout the handoff.
        if(returning){blendSignature='';applyDrivenBlend(returnMode);}
        const destination=returning?{positions:current,colors:currentColors}:assets[target];
        const meshEnds=returning?assets.map(a=>a.mesh.material.opacity):assets.map((_,i)=>i===target?1:0);
        const endPointOpacity=returning?points.material.opacity:0;
        const t=clamp((now-started)/HOVER_DURATION),p=ease(t);
        writeParticles({positions:starts,colors:startColors},destination,p,Math.sin(Math.PI*p));
        const arrival=ease((t-.75)/.25);
        points.material.opacity=(startPointOpacity+(1-startPointOpacity)*ease(t/.18))*(1-arrival)+endPointOpacity*arrival;
        assets.forEach((asset,i)=>{setMeshOpacity(asset,meshStarts[i]*(1-ease(t/.23))+meshEnds[i]*ease((t-.76)/.24));if(!returning)asset.mesh.renderOrder=0;});
        transition=t<1;points.visible=points.material.opacity>.001;host.dataset.morphing=String(transition);syncVideo();
        if(returning&&!transition){mode=returnMode;blendSignature='';applyDrivenBlend();}
    }
    const itemAt=element=>entries.find(item=>item.entry===element?.closest?.('.tl-entry'))||null;
    function syncSelection(fallback=pointerPosition&&!scrollOnly.matches?'cursor':'scroll'){
        const item=focusedItem||hoveredItem;
        if(item)select(item.selection);else resumeDriven(fallback);
    }
    function syncPointer(){
        if(scrollOnly.matches)return;
        hoveredItem=pointerPosition?itemAt(document.elementFromPoint(pointerPosition.x,pointerPosition.y)):null;
        syncSelection('scroll');
    }
    function refreshInputMode(){
        host.dataset.inputMode=scrollOnly.matches?'scroll':'cursor';
        hoveredItem=focusedItem=pointerPosition=null;
        cursor.x=cursor.y=smooth.x=smooth.y=0;
        mode='scroll';requestedKey=null;transition=false;blendSignature='';
        host.dataset.engaged='false';layoutDirty=true;wake();
    }
    scrollOnly.addEventListener('change',refreshInputMode);
    refreshInputMode();
    for(const item of entries){
        const {entry,source,selection}=item;
        entry.addEventListener('pointerenter',event=>{
            if(scrollOnly.matches||event.pointerType==='touch')return;
            pointerPosition={x:event.clientX,y:event.clientY};hoveredItem=item;syncSelection();
        });
        entry.addEventListener('pointerleave',event=>{
            if(scrollOnly.matches||event.pointerType==='touch')return;
            hoveredItem=itemAt(event.relatedTarget);syncSelection();
        });
        entry.addEventListener('focusin',event=>{if(!scrollOnly.matches&&event.target.matches(':focus-visible')){focusedItem=item;syncSelection();}});
        entry.addEventListener('focusout',event=>{if(!entry.contains(event.relatedTarget)){focusedItem=null;syncSelection();}});
        source.addEventListener('click',()=>select(selection));
        if(source.dataset.logoMorph!=='paper')source.addEventListener('keydown',event=>{if(!scrollOnly.matches&&(event.key==='Enter'||event.key===' ')){event.preventDefault();select(selection);}});
    }
    window.addEventListener('pointermove',event=>{
        if(scrollOnly.matches||event.pointerType==='touch')return;
        const x=clamp(event.clientX/width*2-1,-1,1),y=clamp(event.clientY/height*2-1,-1,1);
        pointerPosition={x:event.clientX,y:event.clientY};focusedItem=null;
        if(!stopped()){cursor.x=x;cursor.y=y;wake();}
        hoveredItem=itemAt(event.target);syncSelection();
    },{passive:true});
    window.addEventListener('pointerdown',event=>{
        focusedItem=null;
        if(event.pointerType==='touch'){pointerPosition=null;hoveredItem=null;}
        syncSelection();
    },{passive:true});
    document.documentElement.addEventListener('pointerleave',()=>{cursor.x=0;cursor.y=0;pointerPosition=null;hoveredItem=null;syncSelection();wake();});
    window.addEventListener('scroll',()=>{
        // Hover/focus takes priority. Hit-test after scrolling because the row
        // under a stationary pointer may have moved, even without pointermove.
        syncPointer();wake();
    },{passive:true});
    motionButton.addEventListener('click',()=>{
        userPaused=!userPaused;refreshMotionButton();blendSignature='';
        if(stopped()&&transition)updateHoverTransition(started+HOVER_DURATION);syncVideo();wake();
    });
    reduced.addEventListener('change',()=>{refreshMotionButton();blendSignature='';if(reduced.matches&&transition)updateHoverTransition(started+HOVER_DURATION);layoutDirty=true;syncVideo();wake();});
    function desiredScale(){
        const a=assets[from].bounds,b=assets[to].bounds,p=blendAmount;
        const boundX=a.x+(b.x-a.x)*p,boundY=a.y+(b.y-a.y)*p;
        return Math.min(12*.48/boundX,worldHeight*.50/boundY);
    }
    function draw(now){
        frame=0;if(document.hidden||!renderer)return;
        const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
        if(mode==='scroll'||mode==='cursor')applyDrivenBlend();else updateHoverTransition(now);
        const fit=desiredScale();
        if(!stopped()){
            // Every device shares the same steady spin; changing assets or
            // scrolling never restarts the rotation.
            spinAngle+=dt*Math.PI*2/SPIN_SECONDS;
            if(scrollOnly.matches){
                scale=fit;group.rotation.set(.08,spinAngle-.16,0,'YXZ');
            }else{
                smooth.x=THREE.MathUtils.damp(smooth.x,cursor.x,3.8,dt);smooth.y=THREE.MathUtils.damp(smooth.y,cursor.y,3.8,dt);
                scale=THREE.MathUtils.damp(scale,fit,5,dt);
                group.rotation.set(.08-smooth.y*.12,spinAngle-.16,-smooth.x*.035,'YXZ');
            }
        }else if(layoutDirty){scale=fit;if(reduced.matches)group.rotation.set(.08,-.16,0,'YXZ');}
        // The orthographic camera's origin is the exact viewport center.
        // Cursor movement tilts the artwork without shifting its center.
        group.position.set(0,0,0);
        group.scale.setScalar(scale);layoutDirty=false;
        assets.forEach(asset=>{if(asset.videoPlaying)asset.updateVideoFrame(now);});
        renderer.render(scene,camera);
        host.dataset.particleOpacity=points.material.opacity.toFixed(3);
        host.dataset.solidOpacity=assets[target].mesh.material.opacity.toFixed(3);
        if(scrollOnly.matches||now-hudAt>160){hudAt=now;host.dataset.yaw=group.rotation.y.toFixed(3);host.dataset.pitch=group.rotation.x.toFixed(3);host.dataset.offsetX=group.position.x.toFixed(3);host.dataset.offsetY=group.position.y.toFixed(3);host.dataset.scale=scale.toFixed(3);}
        if(!stopped()||transition||assets.some(asset=>asset.videoPlaying))wake();
    }
    function wake(){if(!frame&&renderer&&assets&&!document.hidden)frame=requestAnimationFrame(draw);}
    function resize(){
        width=host.clientWidth||innerWidth;height=host.clientHeight||innerHeight;worldHeight=12*height/width;
        if(!renderer)return;
        if(points)points.material.size=scrollOnly.matches?2.1:1.8;
        renderer.setSize(width,height,false);camera.left=-6;camera.right=6;camera.top=worldHeight/2;camera.bottom=-worldHeight/2;camera.updateProjectionMatrix();layoutDirty=true;measureTimeline();wake();
    }
    refreshMotionButton();host.dataset.asset='tau';host.dataset.paperTitle='';host.dataset.mode='scroll';
    try{
        renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
        scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-6,6,worldHeight/2,-worldHeight/2,.1,100);camera.position.z=18;
        group=new THREE.Group();scene.add(group);scene.add(new THREE.HemisphereLight('#fff9ef','#b1a293',2.6));
        const key=new THREE.DirectionalLight('#fff8ea',3.3);key.position.set(-4,5,7);scene.add(key);const fill=new THREE.DirectionalLight('#d6e6ff',1.9);fill.position.set(5,1,-3);scene.add(fill);
        assets=await Promise.all(descriptors.map(async descriptor=>{
            if(descriptor.kind!=='object')return createLogoAsset(descriptor);
            const scroll=await createScrollAsset(descriptor,{mediaHost,onPlaybackChange:wake});
            try{await scroll.setTitle(descriptor.title,'illustrated');}
            catch(error){await scroll.setTitle(descriptor.title,'name');console.warn('Using a title-only background scroll:',error);}
            scroll.setPlayback(false);return scroll;
        }));
        assets.forEach((asset,i)=>{asset.mesh.geometry.computeBoundingBox();asset.bounds=asset.mesh.geometry.boundingBox.getSize(new THREE.Vector3());setMeshOpacity(asset,i===target?1:0);group.add(asset.mesh);});
        current=new Float32Array(assets[target].positions);currentColors=new Float32Array(assets[target].colors);starts=current.slice();startColors=currentColors.slice();
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(current,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('color',new THREE.BufferAttribute(currentColors,3).setUsage(THREE.DynamicDrawUsage));
        const sprite=document.createElement('canvas');sprite.width=sprite.height=32;
        const spriteContext=sprite.getContext('2d');spriteContext.fillStyle='#fff';spriteContext.beginPath();spriteContext.arc(16,16,14,0,Math.PI*2);spriteContext.fill();
        points=new THREE.Points(geometry,new THREE.PointsMaterial({size:1.8,sizeAttenuation:false,color:'#b3a797',map:new THREE.CanvasTexture(sprite),alphaTest:.08,vertexColors:true,transparent:true,opacity:0,depthWrite:false}));points.visible=false;points.frustumCulled=false;group.add(points);
        measureTimeline();if(mode==='scroll'||mode==='cursor')applyDrivenBlend();else{from=to=target;metadata();}
        scale=desiredScale();group.scale.setScalar(scale);group.rotation.set(.08,-.16,0,'YXZ');
        resize();new ResizeObserver(resize).observe(host);new ResizeObserver(measureTimeline).observe(document.querySelector('.container'));document.fonts?.ready.then(measureTimeline);
        document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();syncVideo();wake();});
        canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();host.classList.remove('is-ready');host.dataset.ready='false';renderer=null;syncVideo();motionButton.hidden=true;});
        host.classList.add('is-ready');host.dataset.ready='true';host.dataset.artwork='ready';motionButton.hidden=false;syncVideo();wake();
    }catch(error){
        renderer?.dispose();renderer=null;assets?.forEach(asset=>asset.setPlayback?.(false));host.classList.remove('is-ready');host.dataset.ready='false';motionButton.hidden=true;console.warn('Decorative 3D background unavailable:',error);
    }
}
mountBackground();
