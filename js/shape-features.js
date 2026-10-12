/* Scale-invariant shape retrieval; VLFeat's small WASM runtime is bundled. */
(function(root,factory){const api=factory(root);if(typeof module!=="undefined"&&module.exports)module.exports=api;root.LaceShapeFeatures=api;})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  const MAX_POINTS=650, DIM=128;
  let pending, runtime, activeIndex;
  const decoded=new WeakMap();
  function ready(){
    if(!pending){const factory=root.createLaceShapeModule||(typeof require==="function"?require("./vendor/shape-wasm.js"):null);if(!factory)return Promise.reject(new Error("花纹特征组件未加载"));pending=factory().then(function(m){runtime=m;return m;});}
    return pending;
  }
  function encode(bytes){if(typeof Buffer!=="undefined")return Buffer.from(bytes).toString("base64");let s="";for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s);}
  function decode(s){if(typeof Buffer!=="undefined")return new Uint8Array(Buffer.from(s,"base64"));return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0);});}
  function unpack(level){let d=decoded.get(level);if(!d){const bytes=decode(level.p);if(bytes.length!==level.n*4)throw new Error("Invalid point data");const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),points=new Float32Array(level.n*2);for(let i=0;i<points.length;i++)points[i]=view.getUint16(i*2,true)/32;d={points:points,descriptors:decode(level.d)};decoded.set(level,d);}return d;}
  function usable(shape){return !!shape&&shape.v===1&&Number.isInteger(shape.width)&&shape.width>=16&&shape.width<=720&&Number.isInteger(shape.height)&&shape.height>=16&&shape.height<=720&&Array.isArray(shape.levels)&&shape.levels.length>0&&shape.levels.length<=2&&shape.levels.every(function(l){if(!Number.isInteger(l.n)||l.n<0||l.n>MAX_POINTS||typeof l.p!=="string"||typeof l.d!=="string")return false;try{const p=unpack(l);return p.points.length===l.n*2&&p.descriptors.length===l.n*DIM;}catch(e){return false;}});}
  async function extract(gray,width,height,featureTop,library){
    const m=await ready(),cv=(await root.LaceLocalFeatures.ready()).cv,offset=featureTop||0;
    const source=cv.matFromArray(height-offset,width,cv.CV_8U,gray.subarray(offset*width));
    const levels=[];
    try{
      for(const scale of library?[1]:[1,0.5]){
        const resized=new cv.Mat(),equalized=new cv.Mat(),smooth=new cv.Mat(),clahe=new cv.CLAHE(2,new cv.Size(8,8));let input=0,points=0,desc=0;
        try{
          cv.resize(source,resized,new cv.Size(Math.round(width*scale),Math.round((height-offset)*scale)),0,0,cv.INTER_AREA);
          clahe.apply(resized,equalized);cv.GaussianBlur(equalized,smooth,new cv.Size(0,0),1.5,1.5,cv.BORDER_DEFAULT);
          input=m._malloc(smooth.rows*smooth.cols*4);points=m._malloc(MAX_POINTS*16);desc=m._malloc(MAX_POINTS*DIM);
          m.HEAPF32.set(Float32Array.from(smooth.data),input/4);
          const n=m._lace_extract(input,smooth.cols,smooth.rows,MAX_POINTS,1.5,points,desc);
          if(n<0)throw new Error("花纹特征提取失败");
          const p=new Uint8Array(n*4),view=new DataView(p.buffer);
          for(let i=0;i<n;i++){view.setUint16(i*4,Math.round(m.HEAPF32[points/4+i*4]/scale*32),true);view.setUint16(i*4+2,Math.round((m.HEAPF32[points/4+i*4+1]/scale+offset)*32),true);}
          levels.push({n:n,p:encode(p),d:encode(m.HEAPU8.slice(desc,desc+n*DIM)),scale:scale});
        }finally{[input,points,desc].forEach(function(p){if(p)m._free(p);});[resized,equalized,smooth,clahe].forEach(function(x){x.delete();});}
      }
    }finally{source.delete();}
    return {v:1,width:width,height:height,levels:levels};
  }
  function variant(bytes,kind){
    if(kind===0)return bytes;const out=new Uint8Array(bytes.length);
    // Contrast reversal rotates the canonical SIFT frame by pi. Reflection
    // reverses its y axis and gradient angle. No extra feature extraction.
    for(let i=0;i<bytes.length;i+=DIM)for(let y=0;y<4;y++)for(let x=0;x<4;x++)for(let o=0;o<8;o++){
      let yy=y,xx=x,oo=o;if(kind&1){yy=3-yy;xx=3-xx;}if(kind&2){yy=3-yy;oo=(8-oo)%8;}
      out[i+(y*4+x)*8+o]=bytes[i+(yy*4+xx)*8+oo];
    }return out;
  }
  function indexFor(samples){
    if(activeIndex&&activeIndex.samples.length===samples.length&&samples.every(function(s,i){return s.shape===activeIndex.shapes[i];}))return activeIndex;
    const m=runtime;if(activeIndex){m._lace_index_delete(activeIndex.pointer);activeIndex=null;}
    let total=0;const shapes=samples.map(function(s){if(!usable(s.shape))throw new Error("样本索引需要重建");total+=s.shape.levels[0].n;return s.shape;});
    const owner=new Uint32Array(total),point=new Uint32Array(total),pointer=m._malloc(total*DIM);let cursor=0;
    try{shapes.forEach(function(s,i){const l=s.levels[0];m.HEAPU8.set(unpack(l).descriptors,pointer+cursor*DIM);for(let j=0;j<l.n;j++){owner[cursor+j]=i;point[cursor+j]=j;}cursor+=l.n;});
      const forest=total?m._lace_index(pointer,total,4):0;if(total&&!forest)throw new Error("无法创建花纹索引");
      activeIndex={samples:samples,shapes:shapes,pointer:forest,owner:owner,point:point,total:total};return activeIndex;
    }finally{m._free(pointer);}
  }
  function candidates(query,samples){
    if(!runtime||!usable(query))throw new Error("花纹特征尚未准备好");
    const index=indexFor(samples),m=runtime,rows=samples.map(function(s,i){return {index:i,sample:s,votes:0,groups:[]};});
    if(!index.total)return rows;
    const k=Math.min(8,index.total);
    query.levels.forEach(function(level,li){const q=unpack(level);if(!level.n)return;
      const input=m._malloc(level.n*DIM),ids=m._malloc(level.n*k*4),dist=m._malloc(level.n*k*4);
      try{for(let v=0;v<4;v++){
        m.HEAPU8.set(variant(q.descriptors,v),input);m._lace_query(index.pointer,input,level.n,k,256,ids,dist);
        const groups=rows.map(function(){return [];});
        for(let i=0;i<level.n;i++){
          const found=new Map();for(let j=0;j<k;j++){const pos=i*k+j,global=m.HEAPU32[ids/4+pos],distance=m.HEAPF32[dist/4+pos];if(global>=index.total||distance>.5)continue;const si=index.owner[global];if(!found.has(si))found.set(si,{q:i,s:index.point[global],distance:distance});}
          found.forEach(function(match,si){let competitor=Infinity;found.forEach(function(other,oi){if(oi!==si)competitor=Math.min(competitor,other.distance);});if(match.distance<.9*competitor)groups[si].push(match);});
        }
        groups.forEach(function(matches,si){if(!matches.length)return;const vote=matches.reduce(function(sum,r){return sum+Math.pow(Math.max(0,1-r.distance/.5),2);},0);rows[si].votes=Math.max(rows[si].votes,vote);rows[si].groups.push({level:li,variant:v,matches:matches});});
      }}finally{[input,ids,dist].forEach(function(p){m._free(p);});}
    });
    return rows.sort(function(a,b){return b.votes-a.votes;});
  }
  function pairGroups(query, ref){
    const m=runtime,l=ref.levels[0],groups=[];if(l.n<2)return groups;
    const p=m._malloc(l.n*DIM);m.HEAPU8.set(unpack(l).descriptors,p);const forest=m._lace_index(p,l.n,2);m._free(p);
    try{query.levels.forEach(function(level,li){if(!level.n)return;const input=m._malloc(level.n*DIM),ids=m._malloc(level.n*8),dist=m._malloc(level.n*8);
      try{for(let v=0;v<4;v++){m.HEAPU8.set(variant(unpack(level).descriptors,v),input);m._lace_query(forest,input,level.n,2,256,ids,dist);const matches=[];
        for(let i=0;i<level.n;i++){const a=m.HEAPF32[dist/4+i*2],b=m.HEAPF32[dist/4+i*2+1];if(a<.49&&a<.81*b)matches.push({q:i,s:m.HEAPU32[ids/4+i*2],distance:a});}
        groups.push({level:li,variant:v,matches:matches});
      }}finally{[input,ids,dist].forEach(p=>m._free(p));}
    });}finally{m._lace_index_delete(forest);}return groups;
  }
  function sane(h,width,height){if(!h||h.length!==9||!Array.from(h).every(Number.isFinite))return false;const ds=[h[8],h[6]*width+h[8],h[7]*height+h[8],h[6]*width+h[7]*height+h[8]];if(ds.some(function(d){return Math.abs(d)<1e-5||d*ds[0]<=0;}))return false;const a=h[0]/h[8],b=h[1]/h[8],c=h[3]/h[8],d=h[4]/h[8],det=a*d-b*c;return det>.02&&det<36&&(a*a+b*b+c*c+d*d)/det<12;}
  function verify(query,row,pairwise){
    const cv=root.cv||(typeof require==="function"?require("./vendor/opencv.js"):null),ref=row.sample.shape,right=unpack(ref.levels[0]);let best={score:0,inliers:0,matches:0,coverage:0,verified:false,method:"shape"};
    for(const group of (pairwise?pairGroups(query,ref):row.groups)){
      const left=unpack(query.levels[group.level]),matches=group.matches.slice().sort(function(a,b){return a.distance-b.distance;}),used=new Set(),good=[];
      for(const match of matches){if(used.has(match.s))continue;const qx=left.points[match.q*2],qy=left.points[match.q*2+1],sx=right.points[match.s*2],sy=right.points[match.s*2+1];if(good.some(function(g){return Math.hypot(qx-g.qx,qy-g.qy)<3||Math.hypot(sx-g.sx,sy-g.sy)<3;}))continue;used.add(match.s);good.push({...match,qx:qx,qy:qy,sx:sx,sy:sy});}
      if(good.length<8)continue;
      const qa=good.flatMap(function(g){return [group.variant&2?query.width-1-g.qx:g.qx,g.qy];}),sa=good.flatMap(function(g){return [g.sx,g.sy];});
      const src=cv.matFromArray(good.length,1,cv.CV_32FC2,qa),dst=cv.matFromArray(good.length,1,cv.CV_32FC2,sa),mask=new cv.Mat();let h;
      try{cv.setRNGSeed(13579);h=cv.findHomography(src,dst,cv.RANSAC,5,mask,1000,.99);if(h.empty()||!sane(h.data64F,query.width,query.height))continue;
        const inliers=good.filter(function(g,i){return mask.data[i];}),n=inliers.length,ratio=n/good.length;
        if(n<8)continue;
        const area=function(x,y){return (Math.max(...inliers.map(g=>g[x]))-Math.min(...inliers.map(g=>g[x])))*(Math.max(...inliers.map(g=>g[y]))-Math.min(...inliers.map(g=>g[y])));};
        const coverage=area('qx','qy')/(query.width*query.height),refCoverage=area('sx','sy')/(ref.width*ref.height);
        if(coverage<.06||refCoverage<.025||ratio<.25)continue;
        const score=.75*(1-Math.exp(-Math.max(0,n-4)/22))+.15*ratio+.1*Math.min(1,coverage/.35);
        if(score>best.score)best={score:score,inliers:n,matches:good.length,coverage:coverage,verified:true,method:"shape",mirrored:!!(group.variant&2),queryScale:query.levels[group.level].scale};
      }finally{if(h)h.delete();mask.delete();dst.delete();src.delete();}
    }return best;
  }
  function dispose(){if(activeIndex&&runtime)runtime._lace_index_delete(activeIndex.pointer);activeIndex=null;}
  return {ready:ready,extract:extract,usable:usable,candidates:candidates,verify:verify,dispose:dispose};
});
