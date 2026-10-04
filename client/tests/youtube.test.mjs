import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYouTubeID,canonicalPosition,clockSample,driftNeedsSeek} from '../src/youtube-sync.mjs';
test('YouTube IDs and strict official URLs',()=>{
 for(const url of ['M7lc1UVf-VE','https://www.youtube.com/watch?v=M7lc1UVf-VE&t=10','https://youtu.be/M7lc1UVf-VE?si=x','https://m.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube.com/embed/M7lc1UVf-VE','https://youtube.com/live/M7lc1UVf-VE'])assert.equal(parseYouTubeID(url),'M7lc1UVf-VE');
 for(const url of ['javascript:alert(1)','https://youtube.com.evil/watch?v=M7lc1UVf-VE','https://youtube.com@evil/watch?v=M7lc1UVf-VE','https://evil@youtube.com/watch?v=M7lc1UVf-VE','https://youtube.com:80/watch?v=M7lc1UVf-VE','https://youtube.com/watch?v=invalid','https://youtu.be/M7lc1UVf-VE/extra','//youtube.com/watch?v=M7lc1UVf-VE'])assert.equal(parseYouTubeID(url),null,url);
});
test('Clock offset, canonical timeline, drift threshold',()=>{
 const s=clockSample(11050,1000,1100);assert.deepEqual(s,{rtt:100,offset:10000});
 const a={state:'PLAYING',position_reference:120,reference_timestamp:10000,duration:300};assert.equal(canonicalPosition(a,18000),128);assert.equal(canonicalPosition({...a,state:'PAUSED'},18000),120);assert.equal(canonicalPosition(a,9000),120);assert.equal(canonicalPosition(a,900000),300);assert.equal(driftNeedsSeek(.25),false);assert.equal(driftNeedsSeek(1),false);assert.equal(driftNeedsSeek(-1.26),true);
 for(const rtt of [10,80,250,800]) {const sample=clockSample(5000+rtt/2,0,rtt);assert.equal(sample.offset,5000)}
});
