'use strict';
((root)=>{
 const languages=['zh-CN','en'];
 const kinds=['title','heading','button','label','column','note','tab','caption'];
 const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const validKey=key=>{
  const at=key.indexOf('|'),prefix=key.slice(0,at);
  return at>0&&at<=85&&key.length<=345&&kinds.includes(prefix.split('#')[0])&&
   /^(?:[a-z]+)(?:#[A-Za-z][A-Za-z0-9_-]{0,64})?$/.test(prefix)&&key.slice(at+1).trim().length>0;
 };
 const validText=value=>typeof value==='string'&&value.trim().length>0&&value.length<=240&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
 const isValidLabels=value=>record(value)&&Object.keys(value).length<=250&&
  Object.entries(value).every(([key,text])=>validKey(key)&&validText(text));
 const isValid=value=>record(value)&&Object.entries(value).every(([language,labels])=>languages.includes(language)&&isValidLabels(labels));
 const model={isValid,isValidLabels,validKey,validText};
 if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.PageTextModel=model;
})(globalThis);
