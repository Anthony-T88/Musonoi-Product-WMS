'use strict';
globalThis.ClientRelease=Object.freeze({version:'4.8.7',displayVersion:'4.8.7',revision:'4.8.7-ui3'});

if(typeof document!=='undefined'){
 let english=false;
 try{english=localStorage.getItem('musonoi-language')==='en';}catch{}
 document.documentElement.lang=english?'en':'zh-CN';
 const title=document.querySelector('title');
 if(english&&title?.dataset.titleEn)document.title=title.dataset.titleEn;
}
