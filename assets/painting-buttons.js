(() => {
    'use strict';

    const profile = document.querySelector('.profile-paintings');
    const image = profile?.querySelector('.profile-image');
    const host = profile?.querySelector('.painting-hotspots');
    const portrait = profile?.querySelector('.profile-melt');
    const feedback = profile?.querySelector('.painting-feedback');
    if (!image || !host) return;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const running = new Map();
    const logoControls = [...document.querySelectorAll('[data-logo-morph]:not([data-logo-morph="paper"])')]
        .map(element => ({element, label: element.getAttribute('aria-label')}));
    let backgroundButton, backgroundPromise, background, morphButton;
    let backgroundState = 'off';
    let revealSession = 0;
    const paintings = [
        {name: 'elephant', area: [23.3, 11.1, 39.2, 16.7], accent: '#b8dfe4', colors: ['#91d8e2','#d68dd2','#f2bb85'], effect: 'ripple'},
        {name: 'rainbow', area: [72.6, 10.8, 27, 16.6], accent: '#c8e4b4', colors: ['#f68c8c','#f2d579','#a2dda4','#85cae5'], effect: 'prism'},
        {name: 'red', area: [28.3, 32.6, 26.4, 20.3], accent: '#ffacbd', colors: ['#ff799f','#ed99de','#ffc289'], effect: 'spring'},
        {name: 'yellow', area: [70.6, 32, 29.3, 21], accent: '#ffe38d', colors: ['#ffe492','#ffbd66','#c9f0dc'], effect: 'sunburst'}
    ];

    function setMorphEnabled(enabled, announce = true) {
        portrait.dataset.morphEnabled = String(enabled);
        morphButton.setAttribute('aria-pressed', String(enabled));
        portrait.dispatchEvent(new CustomEvent('portrait-morph-change'));
        if (announce) feedback.textContent = enabled ? 'Portrait morphing on.' : 'Portrait morphing off.';
    }

    function setLogoControls(enabled) {
        for (const {element, label} of logoControls) {
            if (enabled) {
                element.setAttribute('role', 'button');
                element.setAttribute('tabindex', '0');
                if (label) element.setAttribute('aria-label', label);
            } else {
                element.removeAttribute('role');
                element.removeAttribute('tabindex');
                element.removeAttribute('aria-label');
            }
        }
    }

    function setBackgroundState(value, announce = true) {
        backgroundState = value;
        profile.dataset.backgroundState = value;
        backgroundButton.setAttribute('aria-pressed', String(value === 'on'));
        backgroundButton.setAttribute('aria-busy', String(value === 'loading'));
        const message = value === 'on' ? '3D background on.' :
            value === 'loading' ? 'Loading 3D…' :
            value === 'error' ? '3D couldn’t load. Reload to try again.' :
            '3D background off.';
        if (announce) feedback.textContent = message;
    }

    function hideBackground(state = 'off') {
        revealSession++;
        background?.setEnabled(false);
        setLogoControls(false);
        setBackgroundState(state);
    }

    async function toggleBackground() {
        if (backgroundState === 'on' || backgroundState === 'loading') {
            hideBackground();
            return;
        }
        const session = ++revealSession;
        setBackgroundState('loading');
        try {
            // Keep the 3D engine unloaded until the yellow painting is pressed.
            backgroundPromise ??= import('./ambient-assets.js?v=8').then(module => module.mountBackground({
                onUnavailable: () => hideBackground('error')
            }));
            background = await backgroundPromise;
            // A second press or leaving the page cancels a pending reveal.
            if (session !== revealSession) return;
            background.setEnabled(true);
            setLogoControls(true);
            setBackgroundState('on');
        } catch (error) {
            if (session !== revealSession) return;
            hideBackground('error');
            console.warn('Decorative 3D background unavailable:', error);
        }
    }

    function clear(button) {
        const previous = running.get(button);
        running.delete(button);
        previous?.animations.forEach(animation => animation.cancel());
        previous?.nodes.forEach(node => node.remove());
        button.classList.remove('is-animating', 'is-down');
    }

    function activate(button, painting, event) {
        clear(button);
        button.classList.add('is-animating');
        if (painting.name !== 'yellow' && painting.name !== 'red') feedback.textContent = `${painting.name[0].toUpperCase()+painting.name.slice(1)} painting pressed.`;
        const face = button.querySelector('.painting-button__face');
        if (!face.animate) {
            button.classList.remove('is-animating');
            return;
        }
        const record = {animations: [], nodes: []};
        running.set(button, record);
        const animate = (element, frames, options) => {
            const animation = element.animate(frames, options);
            // Repeated presses intentionally cancel the previous animation.
            animation.finished.catch(() => {});
            record.animations.push(animation);
            return animation;
        };
        const lifted = button.matches(':focus-visible') || (matchMedia('(hover: hover)').matches && button.matches(':hover'));
        const rest = lifted ? 'translateY(-2px) scale(1.035)' : 'translateY(0) scale(1)';
        const main = reduced.matches
            ? animate(face, [{opacity:1,filter:'brightness(1.25)'},{opacity:1,filter:'brightness(1)'}], {duration:200})
            : animate(face, [
                {transform:'translateY(1px) scale(.945)',filter:'brightness(.88)',offset:0},
                {transform:`translateY(-4px) scale(1.105) rotate(${painting.effect==='spring'?-2:1}deg)`,filter:'brightness(1.18)',offset:.28},
                {transform:'translateY(0) scale(.99) rotate(-.7deg)',filter:'brightness(1.04)',offset:.52},
                {transform:'translateY(-2px) scale(1.045)',filter:'brightness(1)',offset:.73},
                {transform:rest,filter:'brightness(1)',offset:1}
            ], {duration:720,easing:'cubic-bezier(.2,.75,.3,1)'});

        if (!reduced.matches) {
            const rect = button.getBoundingClientRect();
            const x = event.detail ? Math.max(0, Math.min(rect.width, event.clientX-rect.left)) : rect.width/2;
            const y = event.detail ? Math.max(0, Math.min(rect.height, event.clientY-rect.top)) : rect.height/2;
            const add = className => {
                const node = document.createElement('span');node.className=className;node.setAttribute('aria-hidden','true');
                node.style.left=`${x}px`;node.style.top=`${y}px`;button.append(node);record.nodes.push(node);return node;
            };
            const rings = painting.effect==='ripple'?2:1;
            for (let i=0; i<rings; i++) {
                const ring = add('painting-button__ring');
                animate(ring, [
                    {transform:'translate(-50%, -50%) scale(.15)',opacity:.95},
                    {transform:`translate(-50%, -50%) scale(${Math.max(rect.width,rect.height)/9})`,opacity:0}
                ], {duration:560,delay:i*80,easing:'cubic-bezier(.15,.6,.3,1)',fill:'both'});
            }
            const count = painting.effect==='sunburst'?12:painting.effect==='prism'?14:8;
            for (let i=0; i<count; i++) {
                const spark = add('painting-button__spark');
                const angle = i/count*Math.PI*2;
                const distance = Math.min(rect.width,rect.height)*(.4+(i%3)*.15)+12;
                spark.style.color=spark.style.background=painting.colors[i%painting.colors.length];
                if (painting.effect==='sunburst') {spark.style.width='7px';spark.style.height='2px';spark.style.borderRadius='2px';}
                else if(painting.effect==='prism')spark.style.borderRadius='1px';
                animate(spark, [
                    {transform:`translate(-50%, -50%) rotate(${angle}rad) scale(.4)`,opacity:1},
                    {transform:`translate(calc(-50% + ${Math.cos(angle)*distance}px), calc(-50% + ${Math.sin(angle)*distance}px)) rotate(${angle+.4}rad) scale(.1)`,opacity:0}
                ], {duration:440+(i%3)*60,easing:'cubic-bezier(.12,.65,.28,1)',fill:'both'});
            }
        }
        main.finished.then(() => {if(running.get(button)===record)clear(button);}, () => {});
    }

    paintings.forEach((painting, index) => {
        const button = document.createElement('button');
        const [left,top,width,height] = painting.area;
        button.type='button';button.className='painting-button';button.dataset.painting=index;
        button.setAttribute('aria-label',`Press the ${painting.name} painting`);
        if (painting.name === 'yellow') {
            backgroundButton = button;
            button.setAttribute('aria-label', '3D background — yellow painting');
        } else if (painting.name === 'red') {
            morphButton = button;
            button.setAttribute('aria-label', 'Portrait morphing — red painting');
        }
        Object.assign(button.style,{left:`${left}%`,top:`${top}%`,width:`${width}%`,height:`${height}%`});
        button.style.setProperty('--painting-accent',painting.accent);
        // Reuse exactly the pixels underneath the button so the frame itself
        // can lift and depress, without moving the rest of the photograph.
        button.style.setProperty('--painting-size',`${10000/width}% ${10000/height}%`);
        button.style.setProperty('--painting-position',`${left/(100-width)*100}% ${top/(100-height)*100}%`);
        button.innerHTML='<span class="painting-button__face" aria-hidden="true"></span><span class="painting-button__edge" aria-hidden="true"></span>';
        button.addEventListener('pointerdown',event=>{
            if(event.button!==0)return;
            clear(button);button.classList.add('is-down');
        });
        ['pointerup','pointercancel','pointerleave','blur'].forEach(type=>button.addEventListener(type,()=>button.classList.remove('is-down')));
        button.addEventListener('keydown',event=>{
            if((event.key===' '||event.key==='Enter')&&!event.repeat)button.classList.add('is-down');
        });
        button.addEventListener('keyup',()=>button.classList.remove('is-down'));
        button.addEventListener('click',event=>{
            activate(button,painting,event);
            if (painting.name === 'yellow') toggleBackground();
            if (painting.name === 'red') setMorphEnabled(portrait.dataset.morphEnabled !== 'true');
        });
        host.append(button);
    });
    function reset() {
        [...running.keys()].forEach(clear);
        host.querySelectorAll('.is-down').forEach(button=>button.classList.remove('is-down'));
    }
    document.addEventListener('visibilitychange',()=>{if(document.hidden)reset();});
    window.addEventListener('pagehide',()=>{reset();hideBackground();setMorphEnabled(false, false);});
    reduced.addEventListener('change',reset);
    setLogoControls(false);
    setBackgroundState('off', false);
    setMorphEnabled(false, false);
    function ready(){if(image.naturalWidth)host.hidden=false;}
    if(image.complete)ready();else image.addEventListener('load',ready,{once:true});
})();
