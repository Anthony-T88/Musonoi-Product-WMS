'use strict';
function unit(req){return req.user?.language_code==='en'?'MT':'吨';}
function headings(values,req){return values.map(v=>typeof v==='string'?v.replace(/吨|\bt\b/g,unit(req)):v);}
module.exports={unit,headings};
