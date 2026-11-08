'use strict';
const {pinyin}=require('pinyin-pro');
const positions={'系统管理员':'System Administrator','物流经理':'Logistics Manager','物流现场主管':'Logistics Site Supervisor','物流操作员':'Logistics Operator','物流办公室操作员':'Logistics Office Operator','物流现场操作员':'Logistics Field Operator','生产管理部操作员':'Production Operator','生产管理部经理':'Production Manager','出口主管':'Export Supervisor'};
function englishName(name){if(positions[name])return positions[name];if(!/[\u3400-\u9fff]/.test(name||''))return name;return pinyin(name,{toneType:'none',surname:'head',nonZh:'consecutive',type:'array'}).map(s=>s.charAt(0).toUpperCase()+s.slice(1)).join(' ');}
const enrich=u=>({...u,display_name_en:englishName(u.display_name)});
module.exports={englishName,enrich};
