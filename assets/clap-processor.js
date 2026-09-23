import { ClapDetector } from './clap-detector.js?v=2';

// AudioWorklet runs on the audio thread so a busy page cannot miss a clap.
class ClapProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.detector = new ClapDetector(count => this.port.postMessage({count}));
        this.windowSize = Math.round(sampleRate * .01);
        this.count = this.sum = this.difference = this.peak = this.previous = 0;
        this.levelFrames = this.levelPeak = 0;
        this.ready = false;
    }

    process(inputs, outputs) {
        const samples = inputs[0]?.[0];
        if (!samples) return true;
        for (let i = 0; i < samples.length; i++) {
            const value = samples[i];
            this.sum += value * value;
            this.difference += (value - this.previous) ** 2;
            this.peak = Math.max(this.peak, Math.abs(value));
            this.previous = value;
            if (++this.count >= this.windowSize) {
                const rms = Math.sqrt(this.sum / this.count);
                this.detector.process({
                    rms,
                    peak: this.peak,
                    highFrequency: Math.sqrt(this.difference / Math.max(this.sum, 1e-12)) * sampleRate / 48000,
                    time: (currentTime + i / sampleRate) * 1000
                });
                if (this.detector.ready && !this.ready) {
                    this.ready = true;
                    this.port.postMessage({ready: true});
                }
                this.levelPeak = Math.max(this.levelPeak, rms);
                if (++this.levelFrames === 10) {
                    // Send only a level summary, never microphone samples.
                    const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(this.levelPeak, 1e-8)) + 72) / 48));
                    this.port.postMessage({level});
                    this.levelFrames = this.levelPeak = 0;
                }
                this.count = this.sum = this.difference = this.peak = 0;
            }
        }
        // Keep the graph active, with silent output (no microphone feedback).
        for (const output of outputs) for (const channel of output) channel.fill(0);
        return true;
    }
}
registerProcessor('double-clap', ClapProcessor);
