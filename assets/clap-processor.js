import { ClapDetector } from './clap-detector.js?v=1';

// AudioWorklet runs on the audio thread so a busy page cannot miss a clap.
class ClapProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.detector = new ClapDetector(count => this.port.postMessage({count}));
        this.windowSize = Math.round(sampleRate * .01);
        this.count = this.sum = this.difference = this.peak = this.previous = 0;
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
                this.detector.process({
                    rms: Math.sqrt(this.sum / this.count),
                    peak: this.peak,
                    highFrequency: Math.sqrt(this.difference / Math.max(this.sum, 1e-12)),
                    time: (currentTime + i / sampleRate) * 1000
                });
                this.count = this.sum = this.difference = this.peak = 0;
            }
        }
        // Keep the graph active, with silent output (no microphone feedback).
        for (const output of outputs) for (const channel of output) channel.fill(0);
        return true;
    }
}
registerProcessor('double-clap', ClapProcessor);
