'use strict';
const builtins=['admin','export_supervisor','logistics_manager','site_supervisor','logistics_office_operator','logistics_field_operator','production_operator','production_manager','sales_operator','sales_manager','commerce_manager'];
const legacy=['allocation:release','sample:read','sample:write','weigh:read','weigh:write','outbound:approve','outbound:packing','outbound:commerce','outbound:gate','outbound:depart','outbound:supervise'];
const deps={
 'plan:approve':['plan:read','customer:read','master:read'],'plan:commerce-approve':['plan:read','customer:read','master:read'],
 'gate:issue':['gate:read'],'gate:print':['gate:read'],'gate:exit':['gate:read','gate:print'],'printer:manage':['gate:read','gate:print'],
 'co:loading-review':['loading-plan:read'],
 'co:locate':['co:read'],'co:location-manage':['co:read'],'co:temp-locate':['co:read','inventory:read'],
 'co:work-edit':['co:read'],'co:work-submit':['co:read'],'co:completion-review':['co:read'],'co:amend-request':['co:read'],'co:amend-review':['co:read'],
 'co:create':['co:read'],'co:submit':['co:read'],'co:site-review':['co:read'],'co:production-review':['co:read'],'co:withdraw':['co:read'],
 'inventory:export':['inventory:read'],'receipt:write':['receipt:read','inventory:read','master:read'],'receipt:review':['receipt:read','master:read'],
 'customer:write':['customer:read','master:read'],'plan:write':['plan:read','customer:read','master:read'],
 'dispatch:month':['dispatch:read'],'dispatch:write':['dispatch:read','plan:read','customer:read','master:read'],'dispatch:read':['plan:read'],
 'allocation:write':['allocation:read','plan:read','customer:read','inventory:read','master:read'],'allocation:review':['allocation:read','plan:read','master:read'],
 'lot:cancel-approve':['allocation:read','master:read'],'lot:revoke':['allocation:read','master:read'],
 'load:write':['load:read','allocation:read','plan:read','customer:read','inventory:read','master:read'],'load:execute':['load:read','master:read'],'load:review':['load:read','master:read'],
 'loading-plan:write':['loading-plan:read','plan:read','customer:read','master:read'],'loading-plan:match':['loading-plan:read','load:write'],
 'vehicle-arrival:write':['vehicle-arrival:read','master:read'],'document:generate':['load:read','inventory:export','master:read'],
 'packing-template:write':['load:read','master:read'],'outbound:logistics-review':['load:read','master:read'],'outbound:production-approve':['load:read','outbound:read','outbound:approve','master:read'],
 'stocktake:write':['stocktake:read','inventory:read','master:read'],'stocktake:review':['stocktake:read','inventory:read','master:read'],
 'adjust:write':['adjust:read','stocktake:read','inventory:read','master:read'],'adjust:approve':['adjust:read','stocktake:read','inventory:read','master:read'],
 'move:write':['inventory:read','master:read'],'exception:write':['exception:read','inventory:read','master:read'],'exception:review':['exception:read','inventory:read','master:read'],'exception:configure':['exception:read'],
 'label:print':['inventory:read'], 'report:read':['master:read']
};
function expand(values){const out=new Set(values);let changed=true;while(changed){changed=false;for(const p of [...out])for(const d of deps[p]||[])if(!out.has(d)){out.add(d);changed=true;}}return [...out].sort();}
const base=['dashboard:read','master:read','inventory:read'];
const defaults={
 production_operator:[...base,'receipt:read','receipt:write'],
 production_manager:[...base,'receipt:read','receipt:review','load:read','outbound:production-approve','report:read'],
 logistics_field_operator:[...base,'inventory:export','label:print','customer:read','plan:read','allocation:write','lot:revoke','load:execute','vehicle-arrival:write','loading-plan:read','move:write','stocktake:write'],
 logistics_office_operator:[...base,'inventory:export','customer:read','plan:read','allocation:read','load:write','loading-plan:match','vehicle-arrival:read','dispatch:read','document:generate','report:read','stocktake:read'],
 site_supervisor:[...base,'inventory:export','customer:read','plan:read','allocation:review','lot:revoke','load:review','vehicle-arrival:read','loading-plan:read','stocktake:write','stocktake:review','adjust:write','exception:write','report:read'],
 logistics_manager:[...base,'inventory:export','customer:write','plan:write','dispatch:write','allocation:review','lot:revoke','lot:cancel-approve','load:review','loading-plan:write','vehicle-arrival:read','outbound:logistics-review','document:generate','packing-template:write','stocktake:write','stocktake:review','adjust:approve','exception:review','report:read'],
 export_supervisor:[...base,'customer:read','plan:read','dispatch:write','loading-plan:write','vehicle-arrival:read','document:generate','packing-template:write','report:read']
};for(const r of Object.keys(defaults))defaults[r]=expand(defaults[r]);
const presets={sales:{name:'销售与派车',name_en:'Sales and Dispatch',permissions:expand([...base,'customer:write','plan:write','dispatch:write','report:read'])},viewer:{name:'库存只读',name_en:'Inventory Viewer',permissions:[...base]}};
async function valid(c,code){return (await c.query('SELECT * FROM roles WHERE code=$1 AND(code=ANY($2) OR NOT built_in)',[code,builtins])).rows[0]||null;}
function warnings(ps,recommended=[]){return ps.some(p=>!recommended.includes(p)||['users:manage','roles:manage','system:manage','audit:read'].includes(p))?['风险提示：权限可能超出岗位建议职责，包含管理或跨环节操作时请核实职责分离。']:[];}
module.exports={builtins,legacy,deps,expand,defaults,presets,valid,warnings};
