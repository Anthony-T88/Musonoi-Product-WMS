'use strict';

module.exports=function copperStorageLabel(value,language){
 if(value==='临时堆存区')return language==='en'?'New Production Bundles Stock Area':'新生产捆包堆存区';
 if(value==='P3-LEFTOVER')return language==='en'?'Left Over Bundles Stock Area':'剩余捆包堆存区';
 return value;
};
