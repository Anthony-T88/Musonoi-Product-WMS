'use strict';
window.RoutePermissions={
 handlers:[],base:null,
 register(name,matches,resolve){
  if(!this.base){this.base=Router.permission.bind(Router);Router.permission=p=>this.permission(p);}
  const prior=this.handlers.findIndex(h=>h.name===name),handler={name,matches,resolve};
  if(prior<0)this.handlers.push(handler);else this.handlers[prior]=handler;
 },
 permission(page){for(let i=this.handlers.length-1;i>=0;i--){const h=this.handlers[i];if(h.matches(page))return h.resolve(page);}return this.base(page);}
};
