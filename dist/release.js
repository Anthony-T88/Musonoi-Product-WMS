'use strict';
globalThis.ClientRelease=Object.freeze({version:'4.9.0',displayVersion:'4.9.0',revision:'4.9.0-ui16'});

if(typeof document!=='undefined'){
 let language='zh-CN';
 try{const saved=localStorage.getItem('musonoi-language');if(saved==='en'||saved==='fr')language=saved;}catch{}
 document.documentElement.lang=language;
 const title=document.querySelector('title');
 if(title)title.dataset.titleZh=title.textContent;
 const translated=language==='fr'?title?.dataset.titleFr:language==='en'?title?.dataset.titleEn:null;
 if(translated)document.title=translated;
}
