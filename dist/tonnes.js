(function(root){'use strict';
 function scaled(value,places){const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));if(!m)throw Error('无效十进制重量');const digits=m[3]||'',base=10n**BigInt(places);let n=BigInt(m[2])*base+BigInt(digits.slice(0,places).padEnd(places,'0'));if(digits.length>places&&digits[places]>='5')n++;return m[1]? -n:n;}
 function fixed(n,places=4){const sign=n<0n?'-':'';if(n<0n)n=-n;const base=10n**BigInt(places);return sign+(n/base)+'.'+String(n%base).padStart(places,'0');}
 function format(value,group=false){if(value===null||value===undefined||value==='')return '未检斤';const s=fixed(scaled(value,4));if(!group)return s;const [a,b]=s.split('.');return a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+b;}
 function input(value){if(typeof value!=='string'||!/^\d{1,8}(\.\d{1,4})?$/.test(value))throw Error('毛重输入精度错误：最多4位小数');const n=scaled(value,4);if(n<=25n)throw Error('毛重须大于0.0025 t');return n;}
 function sum(values){const valid=values.filter(v=>v!==null&&v!==undefined&&v!=='');return valid.length?format(fixed(valid.reduce((n,v)=>n+scaled(v,6),0n),6)):null;}
 const api={scaled,fixed,format,input,sum};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Tonnes=api;
})(globalThis);
