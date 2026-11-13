'use strict';
// Current user-facing operations. Compatibility grants remain in historical data.
const R=require('./role-catalog.cjs');
const retired=[...R.legacy,'label:print','exception:read','exception:write','exception:review','exception:configure'];
const definitions={
 'dashboard:read':['铜钴信息总览查看','View Copper and Cobalt Overview'],
 'inventory:read':['铜钴库存与地图查看、铜捆包详情档案','View Copper and Cobalt Stock and Maps, and Copper Bundle Archives'],
 'inventory:export':['库存、到厂及装车计划数据导出','Export Stock, Arrivals and Loading Plans'],
 'report:read':['铜钴统计报表查看','View Copper and Cobalt Reports'],
 'master:read':['授权项目、仓库及业务选项读取','Read Authorized Business Options'],
 'master:write':['项目、仓库及基础资料维护','Maintain Master Data'],
 'customer:read':['客户及合同查看','View Customers and Contracts'],
 'customer:write':['客户及销售合同维护','Maintain Customers and Sales Contracts'],
 'plan:read':['铜钴销售计划查看；出口主管及管理员建备货计划、存草稿与提交','View Sales Plans; Export Supervisors and Administrators Can Draft, Create and Submit Preparation Plans'],
 'plan:write':['销售计划新建、草稿、编辑及关闭申请','Draft, Create, Edit and Request Sales Plan Closure'],
 'plan:approve':['销售计划创建、编辑及关闭初审','Sales Review of Creation, Edit and Closure'],
 'plan:commerce-approve':['销售计划创建、编辑及关闭终审','Commercial Final Review of Sales Plans'],
 'dispatch:read':['客户派车单及车辆查看','View Customer Dispatches and Vehicles'],
 'dispatch:write':['客户派车单导入及车辆维护','Import Dispatches and Maintain Vehicles'],
 'receipt:read':['铜入库单及捆包明细查看','View Copper Receipts and Bundles'],
 'receipt:write':['铜入库草稿、建单、编辑及提交','Draft, Create, Edit and Submit Copper Receipts'],
 'receipt:review':['铜入库审核（禁止自审）','Review Copper Receipts Independently'],
 'allocation:read':['铜备货批次及作业记录查看','View Copper Lots and Work Records'],
 'allocation:write':['按已批计划创建铜备货单、检斤、取样、铅封及提交','Create Copper Preparation from Approved Plans, Weigh, Sample, Seal and Submit'],
 'allocation:review':['铜备货审核及授权更正；物流经理及管理员独立审核铜钴备货计划','Review Copper Preparation and Corrections; Logistics Managers and Administrators Independently Review Preparation Plans'],
 'lot:revoke':['铜备货撤回及撤销审核','Withdraw Copper Lots or Revoke Review'],
 'lot:cancel-approve':['铜备货取消申请审核','Review Copper Lot Cancellation'],
 'co:read':['钴入库、备货、批次详情档案及袋级作业查看','View Cobalt Intake, Preparation, Batch Archives and Bag Work'],
 'co:create':['按已批计划保存钴入库备货草稿及建单','Draft and Create Cobalt Preparation from Approved Plans'],
 'co:submit':['钴入库备货提交审核','Submit Cobalt Intake for Review'],
 'co:withdraw':['钴入库备货撤回','Withdraw Cobalt Intake Submission'],
 'co:site-review':['钴历史入库流程现场审核','Site Review of Legacy Cobalt Intake'],
 'co:production-review':['钴入库生产经理终审','Production Manager Final Review of Cobalt Intake'],
 'co:work-edit':['钴备货重量、铅封及取样录入','Record Cobalt Weights, Seals and Samples'],
 'co:work-submit':['钴备货完工提交','Submit Cobalt Preparation Completion'],
 'co:completion-review':['钴备货完工现场主管审核','Site Supervisor Review of Cobalt Completion'],
 'co:amend-request':['钴已完工备货更正申请','Request Cobalt Completed-Work Correction'],
 'co:amend-review':['钴备货更正现场主管复核','Site Supervisor Review of Cobalt Corrections'],
 'co:locate':['钴袋级标记及调整实际货位','Mark and Relocate Cobalt Bags'],
 'co:location-manage':['钴库区、货位及地图配置','Configure Cobalt Zones, Locations and Map'],
 'co:temp-locate':['钴临时存放点标记与移位','Mark and Relocate Temporary Cobalt Stock'],
 'co:loading-review':['钴整批匹配变更及取消审核','Review Cobalt Match Changes and Cancellations'],
 'vehicle-arrival:read':['铜钴到厂车辆及运输资料查看','View Copper and Cobalt Vehicle Arrivals'],
 'vehicle-arrival:write':['铜钴到厂登记及运输资料维护','Register Arrivals and Maintain Transport Details'],
 'export-license:read':['铜钴出口许可证与关联历史查看','View Copper and Cobalt Export Licenses and History'],
 'export-license:write':['出口许可证草稿、申请、附件和审核申请','Draft and Register Export Licenses, Attach Evidence and Request Review'],
 'export-license:approve':['出口许可证独立审核和核销确认','Independently Review Export Licenses and Reconciliation'],
 'loading-plan:read':['铜钴装车计划及单证查看','View Copper and Cobalt Loading Plans'],
 'loading-plan:write':['铜钴装车计划草稿及单证维护','Draft and Maintain Loading Plans and Documents'],
 'loading-plan:match':['铜选货匹配／钴整批匹配及变更申请','Match Copper Bundles or Whole Cobalt Batches'],
 'load:read':['铜钴装车单及审批记录查看','View Loading Orders and Approval Records'],
 'load:write':['铜装车单维护／钴装车完工提交','Maintain Copper Loads or Submit Cobalt Loading'],
 'load:review':['铜装车审核／钴装车完工审核','Review Copper Loads or Cobalt Loading'],
 'load:execute':['装车后出库流程申报（非销售实际出厂确认）','Register the Outbound Workflow after Loading'],
 'outbound:read':['铜钴出库进度及正式出库记录查看','View Outbound Progress and Posted Records'],
 'outbound:logistics-review':['装车离场申报的物流经理审核','Logistics Review of the Outbound Declaration'],
 'outbound:production-approve':['正式出库终审','Final Outbound Approval'],
 'document:generate':['商业发票与装箱单办理草稿、生成及版本归档','Draft, Generate and Archive Commercial Invoices and Packing Lists'],
 'packing-template:write':['装箱单模板维护','Maintain Packing List Templates'],
 'gate:read':['车辆出厂列表、出门证及历史查看','View Vehicle Gate Exit and Permit History'],
 'gate:issue':['最终出库审批后生成及修订出门证','Generate or Revise Permits after Final Outbound Approval'],
 'gate:print':['出门证预览、Excel 下载及 9.5 × 5.5 英寸打印','Preview, Download and Print Gate Permits at 9.5 × 5.5 Inches'],
 'gate:exit':['销售确认车辆实际出厂','Sales Confirmation of Physical Gate Exit'],
 'printer:manage':['出门证历史打印配置及连接检测','Legacy Gate Printer Configuration and Connectivity'],
 'stocktake:read':['铜钴盘点任务及差异查看','View Stocktakes and Differences'],
 'stocktake:write':['铜钴盘点草稿、建单、实盘及提交','Draft, Create, Count and Submit Stocktakes'],
 'stocktake:review':['铜钴盘点独立审核','Independently Review Stocktakes'],
 'adjust:read':['铜盘点与库存调整单查看','View Copper Inventory Adjustments'],
 'adjust:write':['铜库存调整申请及明细维护','Request Copper Inventory Adjustments'],
 'adjust:approve':['铜库存调整独立审批','Independently Approve Copper Inventory Adjustments'],
 'move:write':['铜捆包实际货位调整','Relocate Copper Bundles'],
 'users:manage':['账户、密码及注册申请审批','Manage Accounts, Passwords and Registration Requests'],
 'roles:manage':['岗位角色与现行业务权限维护','Manage Roles and Current Workflow Permissions'],
 'system:manage':['系统设置及业务预警配置','Manage System and Business Alert Settings'],
 'audit:read':['系统操作及授权变更日志查看','View Operation and Authorization Audit Logs']
};
const fixedRoles={
 'plan:write':['sales_operator','sales_manager'],'plan:approve':['sales_manager'],'plan:commerce-approve':['commerce_manager'],
 'co:site-review':['site_supervisor'],'co:production-review':['production_manager'],
 'co:completion-review':['site_supervisor'],'co:amend-review':['site_supervisor'],'co:loading-review':['site_supervisor'],
 'gate:exit':['sales_operator','sales_manager']
};
const copperOnly=new Set(['receipt:read','receipt:write','receipt:review','allocation:read','allocation:write','allocation:review','lot:revoke','lot:cancel-approve','move:write','adjust:read','adjust:write','adjust:approve']);
const catalog=Object.fromEntries(Object.entries(definitions).map(([code,[zh,en]])=>[code,{zh,en,products:code.startsWith('co:')?['CO_HYDROXIDE']:copperOnly.has(code)?['CU_CATHODE']:['CU_CATHODE','CO_HYDROXIDE'],...(fixedRoles[code]?{roles:code==='co:loading-review'?fixedRoles[code]:[...fixedRoles[code],'admin']}:{})}]));
const modules={"dashboard":["overview","信息总览","Overview"],"plan":["sales","销售计划及审批","Sales Plans and Approvals"],"dispatch":["dispatch","客户派车管理","Customer Dispatch"],"customer":["customers","客户与合同","Customers and Contracts"],"receipt":["copper-intake","阴极铜入库","Copper Receipts"],"allocation":["copper-preparation","阴极铜备货","Copper Preparation"],"lot":["copper-preparation","阴极铜备货","Copper Preparation"],"co":["cobalt-preparation","氢氧化钴入库与备货","Cobalt Intake and Preparation"],"vehicle-arrival":["arrivals","车辆到厂登记","Vehicle Arrival"],"export-license":["export-licenses","出口许可证管理","Export License Management"],"loading-plan":["loading-plans","装车计划与匹配","Loading Plans and Matching"],"load":["loading-orders","装车单及装车作业","Loading Orders and Operations"],"outbound":["outbound","出库审批与归档","Outbound Approvals and Records"],"gate":["gate","车辆出厂与出门证","Gate Exit and Permits"],"document":["shipping","装箱单生成","Packing List Generation"],"packing-template":["shipping","装箱单模板","Packing List Templates"],"printer":["printing","打印设备设置","Printer Settings"],"inventory":["inventory","库存查询与导出","Stock Queries and Export"],"move":["placement","实际货位调整","Physical Stock Placement"],"stocktake":["stocktaking","库存盘点","Stocktaking"],"adjust":["adjustment","库存调整","Stock Adjustments"],"master":["master-data","项目仓库与基础资料","Master Data"],"users":["accounts","账户与注册审批","Accounts and Registration"],"roles":["roles","岗位与权限","Roles and Permissions"],"system":["system","系统设置与预警","System and Alerts"],"audit":["audit","操作日志","Audit Log"],"report":["reports","统计报表","Reports"]};for(const [code,entry]of Object.entries(catalog)){const [module,module_zh,module_en]=code.startsWith('co:')&&['co:locate','co:location-manage','co:temp-locate'].includes(code)?['cobalt-placement','氢氧化钴货位与地图','Cobalt Locations and Map']:modules[code.split(':')[0]];Object.assign(entry,{module,module_zh,module_en,protected_admin:['users:manage','roles:manage'].includes(code)});}
catalog['load:review'].product_roles={CO_HYDROXIDE:['site_supervisor','admin']};catalog['outbound:production-approve'].product_roles={CO_HYDROXIDE:['production_manager','admin']};
const active=code=>Object.hasOwn(catalog,code),assignable=(role,code)=>active(code)&&(code==='co:loading-review'?role==='site_supervisor':role==='admin'||!fixedRoles[code]||fixedRoles[code].includes(role));
function present(role){const applicable=p=>assignable(role.code,p);return {...role,caps:role.caps.filter(applicable),permissions:role.permissions.filter(applicable),recommended_permissions:(role.recommended_permissions||[]).filter(applicable)};}
module.exports={catalog,retired,active,assignable,present};
