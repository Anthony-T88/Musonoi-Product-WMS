(function(root){
 'use strict';
 const prefix='MUS-[0-9]{4}-[0-9]{1,3}-';
 const modernPattern=prefix+'(?=[0-9]*[1-9])[0-9]+[A-Z]*';
 const legacyPattern=prefix+'[1-9][0-9]*[A-Z]*';
 const modernNumber=new RegExp('^'+modernPattern+'$'),legacyNumber=new RegExp('^'+legacyPattern+'$');
 const BundleNumber={
  normalize(value,modern=true){
   return String(value??'').trim().toUpperCase().replace(/^MUS-(\d{4})-(\d{1,3})-(\d+)([A-Z]*)$/,
    (_,year,day,serial,suffix)=>'MUS-'+year+'-'+day.padStart(3,'0')+'-'+(modern?serial.padStart(2,'0'):serial)+suffix);
  },
  pattern(modern=true){return modern?modernPattern:legacyPattern;},
  batch(value,modern=true){
   const number=this.normalize(value,modern);
   return (modern?modernNumber:legacyNumber).test(number)?number.slice(0,number.lastIndexOf('-')):'';
  }
 };
 if(typeof module==='object'&&module.exports)module.exports=BundleNumber;else root.BundleNumber=BundleNumber;
})(typeof window==='object'?window:globalThis);
