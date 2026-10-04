import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
test('Source modules are distinct on Windows',()=>{
 const names=readdirSync(new URL('../src/',import.meta.url)).filter(n=>/\.tsx?$/.test(n)).map(n=>n.replace(/\.tsx?$/,'').toLowerCase());
 assert.equal(new Set(names).size,names.length,'Module names collide on a case-insensitive filesystem');
});
