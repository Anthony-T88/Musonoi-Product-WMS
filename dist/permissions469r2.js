'use strict';
window.Permissions469R2={
 names:{
 'preparation-plan:write':['创建、编辑及提交','Create, edit and submit'],'preparation-plan:review':['审核备货计划','Review preparation plans'],
 'co:metal-read':['查看钴金属量','View cobalt metal'],'co:metal-submit':['录入及提交金属量','Enter and submit metal'],
 'dashboard:read':['查看总览','View overview'],'inventory:read':['库存 / 地图','Stock / map'],'inventory:correct-request':['捆包更正申请','Request Bundle Correction'],'inventory:correct-review':['捆包更正审核','Review Bundle Correction'],'inventory:export':['导出库存 / 到厂 / 计划','Export stock / arrivals / plans'],'report:read':['查看报表','View reports'],'master:read':['读取业务选项','Read business options'],'master:write':['维护基础资料','Maintain master data'],'customer:read':['查看客户 / 合同','View customers / contracts'],'customer:write':['维护客户 / 合同','Maintain customers / contracts'],
 'plan:read':['查看计划','View plans'],'plan:write':['新建 / 编辑 / 关闭申请','Create / edit / request closure'],'plan:approve':['初审','Initial review'],'plan:commerce-approve':['终审','Final review'],'dispatch:read':['查看派车单','View dispatches'],'dispatch:write':['导入 / 维护车辆','Import / maintain vehicles'],
 'receipt:read':['查看入库单','View receipts'],'receipt:write':['新建 / 编辑 / 提交','Create / edit / submit'],'receipt:review':['入库审核','Review receipt'],'allocation:read':['查看备货 / 作业','View lots / work'],'allocation:write':['建单 / 检斤 / 取样 / 铅封','Create / weigh / sample / seal'],'allocation:review':['备货审核 / 更正','Review / correct preparation'],'lot:revoke':['撤回 / 撤销审核','Withdraw / revoke review'],'lot:cancel-approve':['取消审批','Review cancellation'],
 'co:read':['查看入库 / 备货','View intake / preparation'],'co:create':['建单','Create'],'co:submit':['提交','Submit'],'co:withdraw':['撤回','Withdraw'],'co:site-review':['历史入库现场审核','Legacy site review'],'co:production-review':['确认入库','Confirm receipt'],'co:work-edit':['重量 / 铅封 / 取样','Weight / seal / sampling'],'co:work-submit':['完工提交','Submit completion'],'co:completion-review':['现场主管审核','Site supervisor review'],'co:amend-request':['更正申请','Request correction'],'co:amend-review':['更正复核','Review correction'],'co:locate':['标记 / 调整货位','Mark / relocate'],'co:location-manage':['货位 / 地图配置','Location / map setup'],'co:temp-locate':['临时点 / 移位','Temporary points / movement'],'co:loading-review':['匹配变更 / 取消审批','Review match change / cancel'],
 'vehicle-arrival:read':['查看到厂资料','View arrivals'],'vehicle-arrival:write':['登记 / 维护运输资料','Register / maintain transport'],'loading-plan:read':['查看计划 / 单证','View plans / documents'],'loading-plan:write':['维护计划 / 单证','Maintain plans / documents'],'loading-plan:match':['选货 / 整批匹配','Select / match batch'],'load:read':['查看装车单','View loads'],'load:write':['新建 / 完工提交','Create / submit completion'],'load:review':['装车审核','Review loading'],'load:execute':['出库日期申报','Stock Issue Date Declaration'],'outbound:read':['查看出库','View stock issues'],'outbound:logistics-review':['物流审核','Logistics review'],'outbound:production-approve':['出库终审','Final stock issue review'],
 'customs:bp':['BP表与清关代理','BP sheets and customs agencies'],'customs:bp-template':['BP表模板','BP sheet template'],'document:generate':['商业发票及装箱单归档','Archive invoices and packing lists'],'packing-template:write':['装箱单模板','Packing list templates'],'gate:read':['查看列表 / 历史','View list / history'],'gate:issue':['生成 / 修订出门证','Issue / revise permit'],'gate:print':['预览 / 下载 / 打印','Preview / download / print'],'gate:exit':['确认实际出厂','Confirm actual exit'],'stocktake:read':['查看盘点任务','View stocktakes'],'stocktake:write':['建单 / 实盘 / 提交','Create / count / submit'],'stocktake:review':['审核','Review'],'adjust:read':['查看调整单','View adjustments'],'adjust:write':['申请 / 维护','Request / maintain'],'adjust:approve':['审批','Approval'],'move:write':['调整实际货位','Adjust physical location'],'users:manage':['账户 / 密码 / 注册审批','Accounts / passwords / registration'],'roles:manage':['岗位 / 权限','Roles / permissions'],'system:manage':['系统 / 业务预警','System / alerts'],'audit:read':['查看操作日志','View audit log']
 },
 init(){if(this.installed)return;this.installed=true;const original=System46.permissionMatrix.bind(System46);System46.permissionMatrix=s=>{original(s);this.render(s);};},
 render(s){
  const area=document.getElementById('account-permissions');if(!area)return;
  const catalog=Accounts.permissionCatalog?.workflow||{},t=(z,e)=>I18n.label(z,e);
  const columns=[['权限模块','Permission Module'],['查看 / 导出','View / Export'],['新建 / 办理','Create / Process'],['审核 / 批准','Review / Approve'],['管理 / 配置','Manage / Configure']];
  area.classList.remove('s46-permission-groups');area.classList.add('s46-r2-permission-area');
  let table=area.querySelector('.s46-r2-matrix');
  const count=details=>{
   const inputs=[...details.querySelectorAll('input[type=checkbox]')];
   const text=t('已选 ','Selected ')+inputs.filter(input=>input.checked).length+' / '+inputs.length;
   const summary=details.querySelector('summary');if(summary.textContent!==text)summary.textContent=text;
  };
  if(!table){
   const groups=new Map();
   for(const label of area.querySelectorAll('label.check-row')){
    const definition=catalog[label.querySelector('input')?.value];if(!definition)continue;
    if(!groups.has(definition.module))groups.set(definition.module,[]);
    groups.get(definition.module).push(label);
   }
   if(!groups.size)return;
   const wrap=document.createElement('div');wrap.className='s46-r2-matrix-scroll';
   table=document.createElement('table');table.className='s46-matrix s46-r2-matrix';table.dataset.v34Enhanced='true';
   table.innerHTML='<thead><tr>'+columns.map(()=>'<th scope="col" data-no-i18n></th>').join('')+'</tr></thead><tbody></tbody>';
   for(const [module,labels] of groups){
    const row=table.tBodies[0].insertRow();row.dataset.permissionModule=module;
    const heading=document.createElement('th');heading.scope='row';heading.dataset.noI18n='';row.append(heading);
    for(let column=0;column<4;column++){
     const cell=row.insertCell();cell.dataset.permissionColumn=column;
     const items=labels.filter(label=>System46.column(label.querySelector('input').value)===column);
     if(!items.length){cell.textContent='—';cell.className='s46-r2-empty';continue;}
     let target=cell;
     if(items.length>1){
      const details=document.createElement('details');details.className='s46-permission-items';
      const summary=document.createElement('summary');summary.dataset.noI18n='';details.append(summary);
      cell.append(details);target=details;
      details.addEventListener('change',()=>count(details));
     }
     for(const label of items)UI46.move(label,target,s);
    }
   }
   wrap.append(table);area.append(wrap);s.generated.push(wrap);
   wrap.addEventListener('permission-selection-changed',()=>{for(const details of table.querySelectorAll('.s46-permission-items'))count(details);});
   for(const node of [...area.children])if(node!==wrap)UI46Pages.hide(node,s);
  }
  for(const [i,cell] of [...table.tHead.rows[0].cells].entries()){const title=t(...columns[i]);if(cell.textContent!==title)cell.textContent=title;}
  for(const row of table.tBodies[0].rows){
   const definition=catalog[row.querySelector('input')?.value],title=definition?.[I18n.usesEnglish?'module_en':'module_zh'];
   if(title&&row.cells[0].textContent!==title)row.cells[0].textContent=title;
  }
  for(const details of table.querySelectorAll('.s46-permission-items'))count(details);
  const roleNames=roles=>roles.map(code=>Accounts.roleName(code)).join(' / ');
  for(const input of table.querySelectorAll('input[value]')){
   const definition=catalog[input.value],label=input.closest('label'),span=label.querySelector('span'),name=this.names[input.value];if(!definition||!span)continue;
   const full=t(definition.zh,definition.en),short=name?t(...name):full;input.setAttribute('aria-label',full);span.dataset.noI18n='';span.dataset.permissionLanguage=I18n.language;
   const notes=[],fixed=definition.roles,cobalt=definition.product_roles?.CO_HYDROXIDE;
   if(fixed)notes.push(t('建议岗位：','Suggested roles:')+' '+roleNames(fixed));
   if(cobalt)notes.push(t('钴业务建议岗位：','Suggested roles for cobalt:')+' '+roleNames(cobalt));
   if(input.dataset.permissionAssignable==='false')notes.push(t('超出当前管理授权','Outside your grant authority'));
   label.title=[full,...notes].join('\n');
   if(notes.length)input.setAttribute('aria-description',notes.join(' · '));
   else input.removeAttribute('aria-description');
   const html=esc(short)+notes.map(note=>'<small class="permission-product-limit">'+esc(note)+'</small>').join('');
   if(span.innerHTML!==html)span.innerHTML=html;
  }
 }
};
window.V469R2={init(){if(this.installed)return;this.installed=true;CobaltStock469R2.init();Permissions469R2.init();}};
