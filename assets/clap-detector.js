// Detect pairs of short, broadband transients, not simply two loud frames.
// Input is one 10 ms summary at a time. No audio is retained.
export class ClapDetector {
    constructor(onClap) {
        this.onClap = onClap;
        this.startedAt = null;
        this.noise = .003;
        this.previousRms = .003;
        this.candidate = null;
        this.firstClap = null;
        this.lastClap = -Infinity;
        this.quietSince = null;
    }

    process({rms, peak, highFrequency, time}) {
        this.startedAt ??= time;
        if (this.firstClap !== null && time - this.firstClap > 1000) {
            this.firstClap = null;
            this.onClap(0);
        }
        if (time - this.startedAt < 500) {
            this.noise += (rms - this.noise) * .08;
            this.previousRms = rms;
            this.quietSince = time;
            return;
        }

        const threshold = Math.max(.012, this.noise * 4.5);
        const quiet = rms < Math.max(.008, this.noise * 2);
        if (quiet) this.quietSince ??= time;

        if (this.candidate) {
            const candidate = this.candidate;
            const duration = time - candidate.time;
            // Confirm a sharp decay; continuous speech/music cannot count twice.
            if (duration > 150) {
                this.candidate = null;
                this.quietSince = null;
            } else if (rms < candidate.rms * .35 || quiet) {
                this.candidate = null;
                this.lastClap = candidate.time;
                const gap = this.firstClap === null ? Infinity : candidate.time - this.firstClap;
                if (gap >= 220 && gap <= 1000) {
                    this.firstClap = null;
                    this.onClap(2);
                } else if (gap > 1000) {
                    this.firstClap = candidate.time;
                    this.onClap(1);
                }
            }
        } else if (
            time - this.lastClap >= 180 && this.quietSince !== null &&
            time - this.quietSince >= 60 && rms > threshold && peak > .06 &&
            rms > this.previousRms * 2 && highFrequency > .45
        ) {
            this.candidate = {time, rms};
        } else {
            // Slowly follow the room's noise floor; don't learn a clap as noise.
            this.noise += (rms - this.noise) * (rms < this.noise ? .08 : .004);
        }

        if (!quiet) this.quietSince = null;
        this.previousRms = rms;
    }
}
