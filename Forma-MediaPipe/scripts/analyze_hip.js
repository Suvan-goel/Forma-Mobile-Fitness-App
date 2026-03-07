function angle2D(a,b,c){
  var ba={x:a.x-b.x,y:a.y-b.y},bc={x:c.x-b.x,y:c.y-b.y};
  var dot=ba.x*bc.x+ba.y*bc.y;
  var m1=Math.sqrt(ba.x*ba.x+ba.y*ba.y),m2=Math.sqrt(bc.x*bc.x+bc.y*bc.y);
  if(m1===0||m2===0)return 0;
  return Math.acos(Math.max(-1,Math.min(1,dot/(m1*m2))))*180/Math.PI;
}
function getKP(kps,n){return kps.find(function(k){return k.name===n;});}
var VIS=0.15;
function isVis(kp){return kp&&kp.score>=VIS;}
function computeHip(kps){
  var ls=getKP(kps,"left_shoulder"),rs=getKP(kps,"right_shoulder");
  var lh=getKP(kps,"left_hip"),rh=getKP(kps,"right_hip");
  var lk=getKP(kps,"left_knee"),rk=getKP(kps,"right_knee");
  var lv=isVis(ls)&&isVis(lh)&&isVis(lk),rv=isVis(rs)&&isVis(rh)&&isVis(rk);
  if(!lv&&!rv)return null;
  if(lv&&rv){
    if((ls.score+lh.score+lk.score)>=(rs.score+rh.score+rk.score))
      return angle2D({x:ls.x,y:ls.y},{x:lh.x,y:lh.y},{x:lk.x,y:lk.y});
    return angle2D({x:rs.x,y:rs.y},{x:rh.x,y:rh.y},{x:rk.x,y:rk.y});
  }
  if(lv)return angle2D({x:ls.x,y:ls.y},{x:lh.x,y:lh.y},{x:lk.x,y:lk.y});
  return angle2D({x:rs.x,y:rs.y},{x:rh.x,y:rh.y},{x:rk.x,y:rk.y});
}

var d=require("./recordings/ab_crunches_expected_4.json");
var vals=d.frames.map(function(f,i){return{i:i,t:f.timestamp/1000,hip:computeHip(f.keypoints)};}).filter(function(x){return x.hip!==null;});
console.log("Frames with hip data:",vals.length,"/ total:",d.frames.length);
console.log("Min raw hip:",Math.min.apply(null,vals.map(function(x){return x.hip;})).toFixed(1));
console.log("Max raw hip:",Math.max.apply(null,vals.map(function(x){return x.hip;})).toFixed(1));

// Sample every 15 frames
var out="";
for(var i=0;i<vals.length;i+=15){
  out+="f"+vals[i].i+"("+vals[i].t.toFixed(1)+"s)="+vals[i].hip.toFixed(0)+" ";
}
console.log("\nSampled hip angles:");
console.log(out);

// Distribution
var ranges={"<80":0,"80-100":0,"100-115":0,"115-130":0,"130-145":0,"145+":0};
vals.forEach(function(v){
  if(v.hip<80)ranges["<80"]++;
  else if(v.hip<100)ranges["80-100"]++;
  else if(v.hip<115)ranges["100-115"]++;
  else if(v.hip<130)ranges["115-130"]++;
  else if(v.hip<145)ranges["130-145"]++;
  else ranges["145+"]++;
});
console.log("\nDistribution:",JSON.stringify(ranges,null,2));

// Simulate SmoothedAngleTracker (median-5 + EMA-0.3)
function SmoothedTracker(){this.buf=[];this.sv=null;}
SmoothedTracker.prototype.push=function(v){
  this.buf.push(v);if(this.buf.length>5)this.buf.shift();
  var s=[].concat(this.buf).sort(function(a,b){return a-b;});
  var mid=Math.floor(s.length/2);
  var med=s.length%2===0?(s[mid-1]+s[mid])/2:s[mid];
  if(this.sv!==null){this.sv=0.3*med+0.7*this.sv;}else{this.sv=med;}
  return this.sv;
};

var tracker=new SmoothedTracker();
var smoothed=vals.map(function(v){return{i:v.i,t:v.t,hip:v.hip,smooth:tracker.push(v.hip)};});

console.log("\nSmoothed hip angles (every 10 frames):");
var out2="";
for(var k=0;k<smoothed.length;k+=10){
  out2+="f"+smoothed[k].i+"="+smoothed[k].smooth.toFixed(1)+" ";
}
console.log(out2);
console.log("Min smoothed:",Math.min.apply(null,smoothed.map(function(x){return x.smooth;})).toFixed(1));
console.log("Max smoothed:",Math.max.apply(null,smoothed.map(function(x){return x.smooth;})).toFixed(1));

// Find smoothed peaks (rep tops) and troughs (rep bottoms)
var peaks=[], troughs=[];
for(var j=2;j<smoothed.length-2;j++){
  var s=smoothed[j].smooth;
  if(s>smoothed[j-1].smooth && s>smoothed[j-2].smooth && s>smoothed[j+1].smooth && s>smoothed[j+2].smooth && s>110){
    peaks.push(smoothed[j]);
  }
  if(s<smoothed[j-1].smooth && s<smoothed[j-2].smooth && s<smoothed[j+1].smooth && s<smoothed[j+2].smooth && s<105){
    troughs.push(smoothed[j]);
  }
}
console.log("\nSmoothed peaks (>110°):");
peaks.forEach(function(p){console.log("  f"+p.i+" t="+p.t.toFixed(2)+"s smooth="+p.smooth.toFixed(1)+" raw="+p.hip.toFixed(1));});
console.log("\nSmoothed troughs (<105°):");
troughs.forEach(function(p){console.log("  f"+p.i+" t="+p.t.toFixed(2)+"s smooth="+p.smooth.toFixed(1)+" raw="+p.hip.toFixed(1));});
