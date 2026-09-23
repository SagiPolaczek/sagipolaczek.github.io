const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));

// Keep every entry reachable, including the final entries that cannot be
// scrolled all the way to the middle of the viewport.
export function timelineAnchors(centers,viewportHeight,maxScroll){
    if(!centers.length||maxScroll<=0)return [0];
    const first=clamp(centers[0]-viewportHeight*.5,Math.min(viewportHeight*.1,maxScroll*.1),maxScroll*.25);
    if(centers.length===1)return [0,Math.min(maxScroll,first)];
    const span=centers.at(-1)-centers[0];
    return [0,...centers.map((center,i)=>first+(maxScroll-first)*(span>0?(center-centers[0])/span:i/(centers.length-1)))];
}

// The solid artwork holds around each reading position; the space between
// entries controls the morph in either direction, with no timer or autoplay.
export function timelineBlend(scrollY,anchors,hold=.1){
    if(anchors.length<2)return {from:0,to:0,progress:0};
    const y=clamp(scrollY,0,anchors.at(-1));
    if(y>=anchors.at(-1))return {from:anchors.length-1,to:anchors.length-1,progress:0};
    let from=0;
    while(from+1<anchors.length&&y>=anchors[from+1])from++;
    const to=Math.min(from+1,anchors.length-1),distance=anchors[to]-anchors[from];
    const fraction=distance>0?(y-anchors[from])/distance:1;
    return {from,to,progress:clamp((fraction-hold)/(1-2*hold))};
}

// In the space around entries, cursor height continuously blends the nearest
// two assets. Direct entry hover is resolved separately to its complete mesh.
export const cursorBlend=(documentY,centers)=>timelineBlend(documentY,centers,0);
