import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSelection} from '../collector/selection.mjs';
test('automatic local fallback resumes following immediately when CDP connects',()=>{
 const base={follow:true,allowLatest:true,recentId:'recent'};
 assert.deepEqual(resolveSelection({...base,connected:false}),{id:'recent',selection:'latest'});
 assert.deepEqual(resolveSelection({...base,connected:true,currentId:'visible'}),{id:'visible',selection:'auto'});
 assert.deepEqual(resolveSelection({...base,connected:true,currentId:null}),{id:null,selection:'none'});
});
test('explicit manual and locked selection survive changes to the visible page',()=>{
 const base={follow:false,manualId:'manual',connected:true,currentId:'visible'};
 assert.deepEqual(resolveSelection(base),{id:'manual',selection:'manual'});
 assert.deepEqual(resolveSelection({...base,lockedId:'locked'}),{id:'locked',selection:'locked'});
 assert.deepEqual(resolveSelection({...base,follow:true,manualId:null}),{id:'visible',selection:'auto'});
});
