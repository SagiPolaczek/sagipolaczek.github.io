const control = document.querySelector('[data-clap-control]');
const panel = control.querySelector('.clap-control__panel');
const trigger = control.querySelector('.clap-control__trigger');
const label = control.querySelector('.clap-control__label');
const badge = control.querySelector('.clap-control__badge');
const listenButton = control.querySelector('.clap-control__listen');
const manualButton = control.querySelector('.clap-control__manual');
const status = control.querySelector('.clap-control__status');
const steps = [...control.querySelectorAll('.clap-control__steps span')];
const meter = control.querySelector('.clap-control__meter');
const meterFill = control.querySelector('.clap-control__meter-fill');
const meterLabel = control.querySelector('.clap-control__meter-label');
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const canListen = !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia &&
    AudioContextClass && window.AudioWorkletNode);
const unavailableMessage = 'Clap detection isn’t available here. You can still show 3D below.';
const logoControls = [...document.querySelectorAll('[data-logo-morph]:not([data-logo-morph="paper"])')]
    .map(element => ({element, label: element.getAttribute('aria-label')}));

let state = 'off';
let microphoneSession = 0;
let revealSession = 0;
let stream, audioContext, source, processor, timeout;
let backgroundPromise, background;

function setLogoControls(enabled) {
    for (const {element, label} of logoControls) {
        if (enabled) {
            element.setAttribute('role', 'button');
            element.setAttribute('tabindex', '0');
            element.setAttribute('aria-label', label);
        } else {
            element.removeAttribute('role');
            element.removeAttribute('tabindex');
            element.removeAttribute('aria-label');
        }
    }
}

function setState(value, message) {
    state = value;
    control.dataset.state = value;
    const activeMic = ['requesting', 'calibrating', 'listening'].includes(value);
    label.textContent = value === 'on' ? 'Hide 3D background' : value === 'loading' ? 'Loading 3D…' :
        value === 'requesting' ? 'Waiting for microphone…' : value === 'calibrating' ? 'Getting ready…' :
        value === 'listening' ? 'Clap twice · listening' : 'Clap twice for 3D';
    badge.textContent = value === 'on' ? 'ON' : ['loading', 'requesting'].includes(value) ? '···' : activeMic ? 'MIC' : 'OFF';
    listenButton.textContent = activeMic ? 'Stop listening' : 'Enable clap detection';
    listenButton.disabled = !canListen || value === 'loading';
    manualButton.disabled = value === 'loading';
    meter.hidden = !['calibrating', 'listening'].includes(value);
    if (message) status.textContent = message;
}

function clapProgress(count) {
    steps.forEach((step, index) => step.classList.toggle('is-heard', index < count));
}

function stopMicrophone() {
    microphoneSession++;
    clearTimeout(timeout);
    if (processor) { processor.port.onmessage = null; processor.onprocessorerror = null; processor.disconnect(); }
    source?.disconnect();
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (audioContext) {
        audioContext.onstatechange = null;
        audioContext.close().catch(() => {});
    }
    stream = audioContext = source = processor = null;
}

function stopListening(message = 'Listening stopped. The background is still off.') {
    stopMicrophone();
    clapProgress(0);
    meterFill.style.transform = 'scaleX(0)';
    meterLabel.textContent = 'Microphone on';
    setState('off', message);
}

function closePanel(restoreFocus = false) {
    if (['requesting', 'calibrating', 'listening'].includes(state)) stopListening();
    if (state === 'loading') hideBackground();
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
}

function openPanel() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (!canListen) status.textContent = unavailableMessage;
    (canListen ? listenButton : manualButton).focus();
}

function hideBackground() {
    revealSession++;
    background?.setEnabled(false);
    setLogoControls(false);
    clapProgress(0);
    setState('off', 'The background is off. Enable listening to try two claps.');
}

async function revealBackground(fromClaps = false) {
    stopMicrophone();
    const session = ++revealSession;
    const restoreFocus = control.contains(document.activeElement);
    setState('loading', fromClaps ? 'Two claps heard! Loading your background…' : 'Loading your 3D background…');
    try {
        backgroundPromise ??= import('./ambient-assets.js?v=8').then(module => module.mountBackground({
            onUnavailable() {
                hideBackground();
                openPanel();
                status.textContent = '3D became unavailable. Reload the page to try again.';
            }
        }));
        background = await backgroundPromise;
        if (session !== revealSession) return;
        background.setEnabled(true);
        setLogoControls(true);
        setState('on', '3D background on. Microphone off.');
        closePanel(restoreFocus);
    } catch (error) {
        if (session !== revealSession) return;
        setState('off', '3D couldn’t load. Try reloading the page.');
        clapProgress(0);
        console.warn('Decorative 3D background unavailable:', error);
    }
}

async function startListening() {
    if (!canListen) return;
    stopMicrophone();
    const session = microphoneSession;
    clapProgress(0);
    setState('requesting', 'Allow microphone access in your browser to begin.');
    // Expire ignored permission prompts too. Late permission grants are released.
    timeout = setTimeout(() => stopListening('Listening timed out. Try again, or show 3D below.'), 30000);
    try {
        const context = new AudioContextClass();
        audioContext = context;
        // Start from the click gesture, including on mobile Safari.
        const resumed = context.resume();
        resumed.catch(() => {});
        const grantedStream = await navigator.mediaDevices.getUserMedia({audio: {
            echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1
        }, video: false});
        if (session !== microphoneSession) {
            grantedStream.getTracks().forEach(track => track.stop());
            return;
        }
        stream = grantedStream;
        await resumed;
        if (session !== microphoneSession) return;
        await context.audioWorklet.addModule(new URL('./clap-processor.js?v=2', import.meta.url));
        if (session !== microphoneSession) return;

        processor = new AudioWorkletNode(context, 'double-clap', {channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1]});
        source = context.createMediaStreamSource(stream);
        let lastSound = performance.now();
        processor.port.onmessage = ({data}) => {
            if (session !== microphoneSession) return;
            if (data.ready && state === 'calibrating') {
                setState('listening', 'Clap twice, about half a second apart.');
            }
            if (typeof data.level === 'number') {
                meterFill.style.transform = `scaleX(${data.level})`;
                if (data.level > .08) lastSound = performance.now();
                meterLabel.textContent = performance.now() - lastSound > 3500 ? 'No sound yet — check your microphone' : 'Microphone on';
                return;
            }
            if (state !== 'listening' || typeof data.count !== 'number') return;
            clapProgress(data.count);
            if (data.count === 2) revealBackground(true);
            else status.textContent = data.count === 1 ? 'One clap heard. One more!' : 'Clap twice, about half a second apart.';
        };
        processor.onprocessorerror = () => {
            if (session === microphoneSession) stopListening('Clap detection stopped. Try again, or show 3D below.');
        };
        source.connect(processor);
        processor.connect(context.destination); // The processor only outputs silence.
        stream.getTracks().forEach(track => {
            track.onended = () => stopListening('Microphone disconnected. Try again, or show 3D below.');
        });
        context.onstatechange = () => {
            if (session === microphoneSession && context.state !== 'running') {
                stopListening('Listening paused. Enable it again when you’re ready.');
            }
        };
        setState('calibrating', 'Getting ready… just a moment.');
        clearTimeout(timeout);
        timeout = setTimeout(() => stopListening('No double clap heard. Try again, or show 3D below.'), 30000);
    } catch (error) {
        if (session !== microphoneSession) return;
        const message = error.name === 'NotAllowedError' ? 'Microphone access wasn’t allowed. You can still show 3D below.' :
            error.name === 'NotFoundError' ? 'No microphone found. You can still show 3D below.' :
            'Couldn’t listen to your microphone. Try again, or show 3D below.';
        stopListening(message);
    }
}

trigger.addEventListener('click', () => {
    if (state === 'on') hideBackground();
    else if (panel.hidden) openPanel();
    else closePanel();
});
control.querySelector('.clap-control__close').addEventListener('click', () => closePanel(true));
listenButton.addEventListener('click', () => {
    if (['requesting', 'calibrating', 'listening'].includes(state)) stopListening();
    else startListening();
});
manualButton.addEventListener('click', () => revealBackground());
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) closePanel(true);
});
document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !control.contains(event.target)) closePanel();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && ['requesting', 'calibrating', 'listening'].includes(state)) {
        stopListening('Listening stopped while you were away. Enable it to try again.');
    }
});
window.addEventListener('pagehide', () => {
    stopMicrophone();
    hideBackground();
    closePanel();
});

setLogoControls(false);
setState('off');
control.hidden = false;
