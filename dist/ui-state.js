'use strict';
// One operating interface. Previous browser preferences cannot restore retired layouts.
window.UIExperience={value:'modern',text:(z,e)=>window.I18n?.language==='en'?e:z,apply(){this.value='modern';document.documentElement.dataset.ui=window.AppSignedIn?'modern':'classic';window.dispatchEvent(new CustomEvent('ui-appearance-changed',{detail:'modern'}));},init(){try{localStorage.removeItem('musonoi-ui-appearance');}catch{}const u=new URL(location.href);if(u.searchParams.has('ui')){u.searchParams.delete('ui');history.replaceState(history.state,'',u.pathname+u.search+u.hash);}this.apply();}};
// Existing shared business components use this internal state API, without a selectable theme.
window.UIAppearance=UIExperience;UIExperience.init();
