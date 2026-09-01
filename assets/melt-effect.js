(() => {
    'use strict';

    const wrapper = document.querySelector('.profile-melt');
    const image = wrapper?.querySelector('.profile-image');
    const canvas = wrapper?.querySelector('.profile-melt-canvas');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!wrapper || !image || !canvas) {
        return;
    }

    const vertexShaderSource = `
        attribute vec2 aPosition;
        varying vec2 vUv;

        void main() {
            vUv = aPosition * 0.5 + 0.5;
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
    `;

    const fragmentShaderSource = `
        precision mediump float;

        uniform sampler2D uTexture;
        uniform vec2 uPointer;
        uniform float uAspect;
        uniform float uTime;
        uniform float uStrength;
        varying vec2 vUv;

        float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);

            return mix(
                mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x),
                f.y
            );
        }

        void main() {
            vec2 uv = vUv;
            vec2 delta = uv - uPointer;
            delta.x *= uAspect;

            float radius = 0.32;
            float localMelt = 1.0 - smoothstep(0.02, radius, length(delta));

            float belowPointer = max(uPointer.y - uv.y, 0.0);
            float inDripZone = 1.0 - step(uPointer.y, uv.y);
            float horizontalNoise = noise(vec2(uv.x * 18.0, uTime * 0.16));
            float wobble = (horizontalNoise - 0.5) * 0.065;
            float dripWidth = 1.0 - smoothstep(0.015, 0.16, abs(delta.x + wobble));
            float dripLength = 1.0 - smoothstep(0.02, 0.48, belowPointer);
            float strands = smoothstep(
                0.36,
                0.82,
                noise(vec2(uv.x * 34.0, uv.y * 4.0 - uTime * 0.7))
            );
            float drips = inDripZone * dripWidth * dripLength * (0.4 + 0.8 * strands);

            float melt = clamp(localMelt + drips, 0.0, 1.0) * uStrength;
            float shimmer = noise(vec2(uv.x * 10.0 + uTime * 0.22, uv.y * 13.0));

            vec2 displacedUv = uv;
            displacedUv -= delta * localMelt * uStrength * 0.13;
            displacedUv.x += (shimmer - 0.5) * 0.065 * melt;
            displacedUv.y += (0.065 + belowPointer * 0.5) * melt;
            displacedUv = clamp(displacedUv, 0.002, 0.998);

            vec4 color = texture2D(uTexture, displacedUv);
            float liquidHighlight = localMelt * uStrength * (shimmer - 0.42) * 0.13;
            color.rgb += liquidHighlight;
            gl_FragColor = color;
        }
    `;

    let gl;
    let program;
    let texture;
    let pointerLocation;
    let aspectLocation;
    let timeLocation;
    let strengthLocation;
    let animationFrame = 0;
    let hoverTarget = 0;
    let strength = 0;
    let lastFrameTime = performance.now();
    const pointer = { x: 0.5, y: 0.5 };
    const pointerTarget = { x: 0.5, y: 0.5 };

    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(message || 'Unable to compile the melt shader.');
        }

        return shader;
    }

    function createProgram() {
        const nextProgram = gl.createProgram();
        const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        gl.attachShader(nextProgram, vertexShader);
        gl.attachShader(nextProgram, fragmentShader);
        gl.linkProgram(nextProgram);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(nextProgram);
            gl.deleteProgram(nextProgram);
            throw new Error(message || 'Unable to link the melt shader.');
        }

        return nextProgram;
    }

    function uploadTexture() {
        const rect = wrapper.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const textureWidth = Math.min(image.naturalWidth, Math.max(1, Math.round(rect.width * dpr * 2)));
        const textureHeight = Math.min(image.naturalHeight, Math.max(1, Math.round(rect.height * dpr * 2)));
        const textureCanvas = document.createElement('canvas');
        const textureContext = textureCanvas.getContext('2d');

        textureCanvas.width = textureWidth;
        textureCanvas.height = textureHeight;
        textureContext.drawImage(image, 0, 0, textureWidth, textureHeight);

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            textureCanvas
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    function resize() {
        const rect = wrapper.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, width, height);
            uploadTexture();
        }

        gl.uniform1f(aspectLocation, rect.width / rect.height);
    }

    function draw(now) {
        animationFrame = 0;
        resize();

        const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.05);
        lastFrameTime = now;
        const easing = reducedMotion.matches ? 1 : 1 - Math.exp(-deltaTime * 12);

        pointer.x += (pointerTarget.x - pointer.x) * easing;
        pointer.y += (pointerTarget.y - pointer.y) * easing;
        strength += (hoverTarget - strength) * easing;

        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.uniform1f(timeLocation, reducedMotion.matches ? 0 : now / 1000);
        gl.uniform1f(strengthLocation, strength);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        if (!reducedMotion.matches && (hoverTarget > 0 || strength > 0.002)) {
            requestDraw();
        }
    }

    function requestDraw() {
        if (!animationFrame) {
            animationFrame = requestAnimationFrame(draw);
        }
    }

    function updatePointer(event) {
        if (event.pointerType === 'touch') {
            return;
        }

        const rect = wrapper.getBoundingClientRect();
        pointerTarget.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        pointerTarget.y = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        requestDraw();
    }

    function enableFallback() {
        wrapper.classList.remove('is-ready');
        wrapper.classList.add('is-fallback');
    }

    function initialize() {
        try {
            const contextOptions = {
                alpha: false,
                antialias: false,
                depth: false,
                powerPreference: 'low-power'
            };
            gl = canvas.getContext('webgl', contextOptions)
                || canvas.getContext('experimental-webgl', contextOptions);

            if (!gl) {
                enableFallback();
                return;
            }

            program = createProgram();
            gl.useProgram(program);

            const positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
                gl.STATIC_DRAW
            );

            const positionLocation = gl.getAttribLocation(program, 'aPosition');
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

            texture = gl.createTexture();
            pointerLocation = gl.getUniformLocation(program, 'uPointer');
            aspectLocation = gl.getUniformLocation(program, 'uAspect');
            timeLocation = gl.getUniformLocation(program, 'uTime');
            strengthLocation = gl.getUniformLocation(program, 'uStrength');
            gl.uniform1i(gl.getUniformLocation(program, 'uTexture'), 0);

            resize();
            gl.uniform2f(pointerLocation, pointer.x, pointer.y);
            gl.uniform1f(timeLocation, 0);
            gl.uniform1f(strengthLocation, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            wrapper.classList.add('is-ready');

            wrapper.addEventListener('pointerenter', (event) => {
                if (event.pointerType === 'touch') {
                    return;
                }

                updatePointer(event);
                pointer.x = pointerTarget.x;
                pointer.y = pointerTarget.y;
                hoverTarget = 1;
                lastFrameTime = performance.now();
                requestDraw();
            });
            wrapper.addEventListener('pointermove', updatePointer);
            wrapper.addEventListener('pointerleave', () => {
                hoverTarget = 0;
                lastFrameTime = performance.now();
                requestDraw();
            });
            window.addEventListener('resize', requestDraw, { passive: true });
            canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                wrapper.classList.remove('is-ready');
                cancelAnimationFrame(animationFrame);
                animationFrame = 0;
            });
        } catch (error) {
            enableFallback();
            console.warn('The profile melt effect could not be initialized.', error);
        }
    }

    if (image.complete && image.naturalWidth) {
        initialize();
    } else {
        image.addEventListener('load', initialize, { once: true });
    }
})();

(() => {
    'use strict';

    const wrapper = document.querySelector('.profile-melt');
    const image = wrapper?.querySelector('.profile-image');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!wrapper || !image) {
        return;
    }

    const minimumSize = 34;
    const growthDuration = 1500;
    let activeBubble = null;

    function drawBubble(state) {
        const { bubble, canvas, size, x, y, imageWidth, imageHeight } = state;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixels = Math.max(1, Math.round(size * dpr));
        const context = canvas.getContext('2d');

        bubble.style.width = `${size}px`;
        bubble.style.height = `${size}px`;

        if (canvas.width !== pixels || canvas.height !== pixels) {
            canvas.width = pixels;
            canvas.height = pixels;
        }

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, size, size);
        const ringCount = Math.max(20, Math.round(size / 4));
        for (let ring = ringCount; ring >= 1; ring -= 1) {
            const radiusProgress = ring / ringCount;
            const radius = size * 0.5 * radiusProgress;
            const edgeCurve = Math.pow(radiusProgress, 3.4);
            const magnification = 1.19 - edgeCurve * 0.48;

            context.save();
            context.beginPath();
            context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
            context.clip();
            context.translate(size / 2, size / 2);
            context.scale(magnification, magnification);
            context.translate(-x, -y);
            context.drawImage(image, 0, 0, imageWidth, imageHeight);
            context.restore();
        }

        context.save();
        context.beginPath();
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        context.clip();
        const edgeShade = context.createRadialGradient(
            size * 0.42,
            size * 0.36,
            size * 0.08,
            size / 2,
            size / 2,
            size / 2
        );
        edgeShade.addColorStop(0, 'rgba(255,255,255,0.08)');
        edgeShade.addColorStop(0.62, 'rgba(255,255,255,0)');
        edgeShade.addColorStop(0.84, 'rgba(191,225,235,0.1)');
        edgeShade.addColorStop(0.96, 'rgba(255,255,255,0.24)');
        edgeShade.addColorStop(1, 'rgba(28,22,18,0.28)');
        context.fillStyle = edgeShade;
        context.fillRect(0, 0, size, size);
        context.restore();
    }

    function growBubble(now) {
        const state = activeBubble;
        if (!state || !state.held) {
            return;
        }

        const progress = Math.min(1, (now - state.startedAt) / growthDuration);
        const eased = 1 - Math.pow(1 - progress, 3);
        state.size = minimumSize + (state.maximumSize - minimumSize) * eased;
        drawBubble(state);
        state.animationFrame = requestAnimationFrame(growBubble);
    }

    function floatBubble(state) {
        if (!state?.held) {
            return;
        }

        state.held = false;
        cancelAnimationFrame(state.animationFrame);
        wrapper.classList.remove('is-pressing');
        if (activeBubble === state) {
            activeBubble = null;
        }

        const travel = state.y + state.size / 2 + 18;
        const drift = reducedMotion.matches ? 0 : (Math.random() - 0.5) * 44;
        const duration = reducedMotion.matches ? 280 : 2250 + state.size * 5;
        const keyframes = [
            {
                transform: 'translate(-50%, -50%) scale(1)',
                opacity: 1
            },
            {
                transform: `translate(calc(-50% + ${drift * 0.35}px), calc(-50% - ${travel * 0.38}px)) scale(1.035)`,
                opacity: 0.96,
                offset: 0.42
            },
            {
                transform: `translate(calc(-50% + ${drift * -0.18}px), calc(-50% - ${travel * 0.72}px)) scale(0.98)`,
                opacity: 0.78,
                offset: 0.76
            },
            {
                transform: `translate(calc(-50% + ${drift}px), calc(-50% - ${travel}px)) scale(0.78)`,
                opacity: 0
            }
        ];

        if (typeof state.bubble.animate === 'function') {
            const animation = state.bubble.animate(keyframes, {
                duration,
                easing: 'cubic-bezier(0.22, 0.68, 0.32, 1)',
                fill: 'forwards'
            });
            animation.addEventListener('finish', () => state.bubble.remove(), { once: true });
            return;
        }

        state.bubble.style.transition = `transform ${duration}ms ease, opacity ${duration}ms ease`;
        requestAnimationFrame(() => {
            state.bubble.style.transform = keyframes[keyframes.length - 1].transform;
            state.bubble.style.opacity = '0';
        });
        window.setTimeout(() => state.bubble.remove(), duration);
    }

    function createBubble(event) {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }

        event.preventDefault();
        if (activeBubble) {
            floatBubble(activeBubble);
        }

        const rect = wrapper.getBoundingClientRect();
        const bubble = document.createElement('span');
        const canvas = document.createElement('canvas');
        const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
        const y = Math.min(rect.height, Math.max(0, event.clientY - rect.top));
        const maximumSize = Math.max(minimumSize, Math.min(144, rect.width * 0.62));

        bubble.className = 'mirror-bubble';
        bubble.style.left = `${x}px`;
        bubble.style.top = `${y}px`;
        bubble.appendChild(canvas);
        wrapper.appendChild(bubble);

        activeBubble = {
            bubble,
            canvas,
            x,
            y,
            imageWidth: rect.width,
            imageHeight: rect.height,
            size: minimumSize,
            maximumSize,
            startedAt: performance.now(),
            animationFrame: 0,
            pointerId: event.pointerId,
            held: true
        };

        drawBubble(activeBubble);
        wrapper.classList.add('is-pressing');
        wrapper.setPointerCapture?.(event.pointerId);
        activeBubble.animationFrame = requestAnimationFrame(growBubble);
    }

    function releaseBubble(event) {
        if (!activeBubble || event.pointerId !== activeBubble.pointerId) {
            return;
        }

        floatBubble(activeBubble);
    }

    wrapper.addEventListener('pointerdown', createBubble);
    wrapper.addEventListener('pointerup', releaseBubble);
    wrapper.addEventListener('pointercancel', releaseBubble);
    wrapper.addEventListener('dragstart', (event) => event.preventDefault());
    wrapper.addEventListener('contextmenu', (event) => event.preventDefault());
})();
