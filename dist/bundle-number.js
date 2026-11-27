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
  },
  productionDate(value,modern=true){
   const batch=this.batch(value,modern);
   if(!batch)return '';
   const [,year,day]=batch.split('-');
   if(day==='000')return '';
   const date=new Date(year+'-01-01T00:00:00Z');
   date.setUTCDate(1+Number(day));
   return date.toISOString().split('T')[0];
  },
  productionDateMessage(expected,entered,language){
   if(language==='en')return expected?'Production date must be '+expected+' for this bundle. Entered date: '+entered+'.':'The production day in the bundle number must be greater than 000.';
   if(language==='fr')return expected?'La date de production de ce paquet doit être le '+expected+'. Date saisie : '+entered+'.':'Le jour de production dans le numéro du paquet doit être supérieur à 000.';
   return expected?'此捆包的生产日期应为 '+expected+'，实际填写 '+entered+'。':'捆包编号中的生产日序号须大于 000。';
  }
 };
 if(typeof module==='object'&&module.exports)module.exports=BundleNumber;else root.BundleNumber=BundleNumber;
})(typeof window==='object'?window:globalThis);
