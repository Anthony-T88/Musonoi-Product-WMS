// Exact millionths of a tonne. No floating point inventory arithmetic.
const B=require('./business-common.cjs');
const fixed=n=>`${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`;
function micro(value){B.weight(value);const [w,d='']=value.split('.');return BigInt(w)*1000000n+BigInt(d.padEnd(6,'0'));}
function calculate(input){let gross;if(input.gross_weight_kg!==undefined){const v=input.gross_weight_kg;if(typeof v!=='string'||!/^\d{1,11}(\.\d{1,3})?$/.test(v))throw B.error(400,'毛重 kg 须为最多三位小数的文本');const [w,d='']=v.split('.');gross=BigInt(w)*1000n+BigInt(d.padEnd(3,'0'));}else gross=micro(input.gross_weight);
 if(gross<=2500n||gross>=100000000000000n)throw B.error(400,'毛重须大于2.5kg且在有效范围内');if(input.gross_weight_kg!==undefined&&input.gross_weight!==undefined&&micro(input.gross_weight)!==gross)throw B.error(400,'kg 与吨的毛重不一致');const net=gross-2500n;
 if(input.net_weight!==undefined&&micro(input.net_weight)!==net)throw B.error(400,'提交净重与毛重扣包结果不一致');
 return {gross_weight:fixed(gross),packaging_weight:'0.002500',net_weight:fixed(net),weight_rule_version:'PACK_2_5KG_V1'};}
module.exports={calculate,micro,fixed};
