import test from 'node:test';
import assert from 'node:assert/strict';
import { ClapDetector } from '../assets/clap-detector.js';

function detect(pulses, {noise = .002, end = 2600} = {}) {
    const events = [];
    const detector = new ClapDetector(count => events.push(count));
    for (let time = 0; time <= end; time += 10) {
        const pulse = pulses.find(p => time >= p.at && time < p.at + (p.duration ?? 30));
        const rms = pulse?.rms ?? noise;
        detector.process({time, rms, peak: pulse ? rms * 4 : noise * 2,
            highFrequency: pulse?.highFrequency ?? 1});
    }
    return events;
}

test('two distinct claps reveal the background once', () => {
    assert.deepEqual(detect([{at: 800, rms: .12}, {at: 1300, rms: .08}]), [1, 2]);
});
test('silence and steady room noise never trigger', () => {
    assert.deepEqual(detect([]), []);
    assert.deepEqual(detect([], {noise: .03}), []);
});
test('a single clap expires without revealing', () => {
    assert.deepEqual(detect([{at: 800, rms: .12}]), [1, 0]);
});
test('an echo is not the second clap', () => {
    assert.deepEqual(detect([{at: 800, rms: .12}, {at: 950, rms: .1}]), [1, 0]);
});
test('claps more than a second apart do not form a pair', () => {
    assert.deepEqual(detect([{at: 800, rms: .12}, {at: 1950, rms: .1}], {end: 3100}), [1, 0, 1, 0]);
});
test('sustained sounds and low-frequency bumps are rejected', () => {
    assert.deepEqual(detect([{at: 800, rms: .12, duration: 400}, {at: 1500, rms: .1, duration: 400}]), []);
    assert.deepEqual(detect([{at: 800, rms: .12, highFrequency: .1}, {at: 1300, rms: .1, highFrequency: .1}]), []);
});
test('soft claps above the noise floor still count', () => {
    assert.deepEqual(detect([{at: 800, rms: .022}, {at: 1300, rms: .025}]), [1, 2]);
});
test('initial microphone startup sounds are ignored', () => {
    assert.deepEqual(detect([{at: 100, rms: .1}, {at: 300, rms: .12}]), []);
});

test('quiet microphone claps are detected relative to the room noise', () => {
    assert.deepEqual(detect([{at: 800, rms: .004}, {at: 1300, rms: .006}], {noise: .0001}), [1, 2]);
});
test('a quick natural double clap counts', () => {
    assert.deepEqual(detect([{at: 800, rms: .08}, {at: 1000, rms: .08}]), [1, 2]);
});
test('microphone filtering does not prevent a clap pair', () => {
    assert.deepEqual(detect([{at: 800, rms: .08, highFrequency: .3}, {at: 1300, rms: .08, highFrequency: .3}]), [1, 2]);
});
test('claps whose peaks arrive after a partial analysis frame still count', () => {
    assert.deepEqual(detect([
        {at: 790, duration: 10, rms: .009}, {at: 800, rms: .08},
        {at: 1290, duration: 10, rms: .009}, {at: 1300, rms: .08}
    ]), [1, 2]);
});
test('a second clap near the timing boundary can finish decaying', () => {
    assert.deepEqual(detect([{at: 800, rms: .08}, {at: 1790, rms: .08}]), [1, 2]);
});
