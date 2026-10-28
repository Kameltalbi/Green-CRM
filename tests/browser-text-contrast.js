(() => {
  const parse = value => { const n=value.match(/[\d.]+/g)?.map(Number); return n?.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0]; };
  const blend=(top,bottom)=>top.slice(0,3).map((n,i)=>n*top[3]+bottom[i]*(1-top[3]));
  const luminance=color=>color.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const failures=[],pairs=new Map();let min=Infinity;const dialog=document.querySelector('dialog[open]');
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){
    const e=node.parentElement;if(!node.textContent.trim()||!e||e.closest('script,style,svg,.sr-only,[aria-hidden="true"]')||(dialog&&!dialog.contains(e)))continue;
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(!r.width||!r.height||s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||e.closest('#toast:not(.visible)'))continue;
    const chain=[];let parent=e;while(parent){chain.unshift(getComputedStyle(parent));parent=parent.parentElement;}
    let bg=[255,255,255];let grid=false;for(const cs of chain){bg=blend(parse(cs.backgroundColor),bg);if(cs.backgroundImage.includes('repeating-linear-gradient'))grid=true;}
    const backgrounds=grid?[bg,[203,213,209]]:[bg];const fg=parse(s.color);
    for(const background of backgrounds){const textColor=blend(fg,background),contrast=ratio(textColor,background);min=Math.min(min,contrast);const key=textColor.map(Math.round).join(',')+'/'+background.map(Math.round).join(',');pairs.set(key,Number(contrast.toFixed(2)));if(contrast<4.5)failures.push({text:node.textContent.trim().slice(0,90),color:s.color,background,ratio:Number(contrast.toFixed(2))});}
  }
  return {minimumRatio:Number(min.toFixed(2)),pairs:Object.fromEntries(pairs),failures};
})()
