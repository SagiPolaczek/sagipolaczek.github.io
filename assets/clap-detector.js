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
        this.lastQuiet = -Infinity;
        this.ready = false;
    }

    process({rms, peak, highFrequency, time}) {
        this.startedAt ??= time;
        if (this.firstClap !== null && !this.candidate && time - this.firstClap > 1000) {
            this.firstClap = null;
            this.onClap(0);
        }
        if (time - this.startedAt < 500) {
            this.noise += (rms - this.noise) * .08;
            this.previousRms = rms;
            if (rms < Math.max(.0006, this.noise * 2)) {
                this.quietSince ??= time;
                this.lastQuiet = time;
            } else this.quietSince = null;
            return;
        }
        this.ready = true;

        // Microphone gain varies widely. Compare with the room rather than
        // requiring every clap to reach a fixed, relatively loud volume.
        const threshold = Math.max(.0012, this.noise * 4);
        const quiet = rms < Math.max(.0006, this.noise * 2);
        if (quiet) {
            this.quietSince ??= time;
            this.lastQuiet = time;
        }

        if (this.candidate) {
            const candidate = this.candidate;
            candidate.rms = Math.max(candidate.rms, rms);
            const duration = time - candidate.time;
            // Confirm a sharp decay; continuous speech/music cannot count twice.
            if (duration > 150) {
                this.candidate = null;
                this.quietSince = null;
            } else if (rms < candidate.rms * .35 || quiet) {
                this.candidate = null;
                this.lastClap = candidate.time;
                const gap = this.firstClap === null ? Infinity : candidate.time - this.firstClap;
                if (gap >= 160 && gap <= 1000) {
                    this.firstClap = null;
                    this.onClap(2);
                } else if (gap > 1000) {
                    this.firstClap = candidate.time;
                    this.onClap(1);
                }
            }
        } else if (
            time - this.lastClap >= 160 && this.quietSince !== null &&
            time - this.quietSince >= 60 && time - this.lastQuiet <= 40 &&
            rms > threshold && peak > Math.max(.004, this.noise * 9) &&
            rms > this.previousRms * 1.7 && highFrequency > .16
        ) {
            this.candidate = {time, rms};
            this.quietSince = null;
        } else {
            // Slowly follow the room's noise floor; don't learn a clap as noise.
            this.noise += (rms - this.noise) * (rms < this.noise ? .08 : .004);
        }

        // A clap can start at the very end of an analysis window. Allow its
        // peak to arrive in the next few windows instead of discarding it.
        if (!quiet && time - this.lastQuiet > 40) this.quietSince = null;
        this.previousRms = rms;
    }
}
