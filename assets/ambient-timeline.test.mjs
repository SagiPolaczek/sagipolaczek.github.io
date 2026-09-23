import assert from 'node:assert/strict';
import { timelineAnchors, timelineBlend, cursorBlend } from './ambient-timeline.js';

for(const {centers,height,max} of [
    {centers:[540,690,840,1030,1200,1400,1570,1740,1950,2150],height:1000,max:1380},
    {centers:[750,950,1160,1410,1640,1900,2160,2400,2740,3020],height:844,max:2440}
]){
    const anchors=timelineAnchors(centers,height,max);
    assert.equal(anchors.length,centers.length+1);
    assert.equal(anchors[0],0);
    assert.equal(anchors.at(-1),max);
    for(let i=1;i<anchors.length;i++)assert.ok(anchors[i]>anchors[i-1],'Ordered, distinct anchors');
    const encountered=new Set();let previous=-1;
    for(let y=0;y<=max;y++){
        const b=timelineBlend(y,anchors),position=b.from+(b.to-b.from)*b.progress;
        assert.ok(position>=previous,'Forward scroll follows DOM order');previous=position;
        encountered.add(b.progress<.5?b.from:b.to);
    }
    assert.equal(encountered.size,anchors.length,'Hero and every entry are reachable');
    for(let i=0;i<anchors.length-1;i++){
        const y=(anchors[i]+anchors[i+1])/2;
        const b=timelineBlend(y,anchors);
        assert.equal(b.from,i);assert.equal(b.to,i+1);
        assert.ok(Math.abs(b.progress-.5)<1e-8,'Midpoint is a controllable half morph');
        assert.deepEqual(timelineBlend(y,anchors),b,'Scroll blend is independent of direction or time');
    }
    assert.deepEqual(timelineBlend(max,anchors),{from:centers.length,to:centers.length,progress:0});
    assert.deepEqual(timelineBlend(-100,anchors),{from:0,to:1,progress:0});
}
assert.deepEqual(timelineBlend(0,timelineAnchors([],800,0)),{from:0,to:0,progress:0});
assert.deepEqual(timelineAnchors([600],800,200),[0,50]);
assert.ok(timelineBlend(15,[0,100]).progress>0,'Particles begin early enough to see during a short mobile swipe');
assert.ok(timelineBlend(85,[0,100]).progress<1,'Particles remain visible toward the next reading position');
const cursorCenters=[200,500,800];
assert.deepEqual(cursorBlend(50,cursorCenters),{from:0,to:1,progress:0});
assert.equal(cursorBlend(275,cursorCenters).progress,.25);
assert.equal(cursorBlend(350,cursorCenters).progress,.5);
assert.equal(cursorBlend(425,cursorCenters).progress,.75);
assert.deepEqual(cursorBlend(650,cursorCenters),{from:1,to:2,progress:.5});
assert.deepEqual(cursorBlend(350,cursorCenters),{from:0,to:1,progress:.5},'Reversing cursor position restores the same blend');
assert.deepEqual(cursorBlend(1000,cursorCenters),{from:2,to:2,progress:0});
console.log('PASS: desktop/mobile order, broad scroll transitions, continuous reversible cursor blends, and all endpoint assets.');
