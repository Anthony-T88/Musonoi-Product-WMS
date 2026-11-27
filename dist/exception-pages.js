'use strict';

(() => {
  const element = id => document.getElementById(id);
  const t = (zh, en) => (window.I18n?.language || document.documentElement.lang) === 'en' ? en : zh;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const states = {
    startup: ['error', '!', '', ['系统页面未能启动', 'WMS could not start'],
      ['页面资源未能加载。请重新加载。如问题持续，请记录发生时间并联系系统管理员。', 'Some page resources did not load. Reload the page. If the problem continues, note when it happened and contact your WMS administrator.']],
    unavailable: ['error', '!', '503', ['仓储服务暂不可用', 'WMS is temporarily unavailable'],
      ['请稍后重新连接。如问题持续，请将故障编号或发生时间提供给系统管理员。', 'Try connecting again in a moment. If the problem continues, share the error reference or the time with your WMS administrator.']],
    offline: ['warning', '×', '', ['当前设备未连接网络', 'Your device is offline'],
      ['恢复可访问 WMS 的网络后再连接系统。如有待确认的提交，请先查询提交结果。', 'Reconnect to a network that can reach WMS. Check the outcome of any pending submission first.']],
    expired: ['info', '◷', '', ['登录已过期', 'Your session has expired'],
      ['请重新登录以继续办理。已保存的单据可在登录后从业务列表重新打开。', 'Sign in again to continue. You can reopen saved documents from their business list.']],
    replaced: ['warning', '!', '', ['账号已在其他设备登录', 'Your account was signed in on another device'],
      ['当前会话已结束。如这次登录并非你本人操作，请联系系统管理员。', 'This session has ended. If you did not sign in on another device, contact your WMS administrator.']],
    forbidden: ['warning', '!', '403', ['你没有权限访问此页面', 'You do not have access to this page'],
      ['请从工作台打开已授权的模块。如工作需要此权限，请联系系统管理员。', 'Open a module you are authorized to use. If you need access for work, contact your WMS administrator.']],
    notFound: ['info', '?', '404', ['找不到此页面', 'This page could not be found'],
      ['链接可能已失效。请返回业务列表查找单据，或从工作台选择其他模块。', 'The link may be out of date. Find the document in its list or open another module from the workspace.']],
    server: ['error', '!', '', ['页面加载失败', 'The page could not load'],
      ['可以使用原条件重试。如问题持续，请将故障编号或发生时间提供给系统管理员。', 'Retry with the same filters. If the problem continues, share the error reference or the time with your WMS administrator.']],
    timeout: ['warning', '◷', '', ['查询超时', 'The query timed out'],
      ['这次查询未能及时返回。可以保留原条件重试，或缩小查询范围。', 'The query did not finish in time. Retry with the same filters or narrow your search.']],
    connection: ['warning', '×', '', ['连接中断', 'Connection interrupted'],
      ['暂时无法连接系统。检查网络后，可以使用原条件重试。', 'WMS could not be reached. Check the network and retry with the same filters.']],
    conflict: ['warning', '↻', '409', ['这条登记已更新', 'This arrival record has changed'],
      ['你本次填写的内容保留在当前页。请先查看最新记录，核对差异后再继续。', 'Your entries are preserved on this page. Review the latest record before continuing.']],
    unknown: ['warning', '◷', '', ['提交结果待确认', 'Submission result is pending'],
      ['本次提交可能已经成功。请先查询本次结果，避免重复提交。', 'The submission may already have succeeded. Check the result before attempting it again.']]
  };
  const action = (key, zh, en) => ({key, label: t(zh, en)});
  const workspace = () => {
    if (typeof Router === 'undefined') return '/';
    for (const nav of document.querySelectorAll('.sidebar nav a[href], .mobile-primary a[href]')) {
      const target = new URL(nav.href, location.origin);
      if (target.origin === location.origin && target.pathname !== location.pathname &&
          Router.routes.some(route => route.pattern.test(target.pathname))) return target.pathname + target.search;
    }
    return '/';
  };
  const backToList = () => {
    const path = '/' + location.pathname.split('/')[1];
    if (path === location.pathname || !Router.routes.some(route => route.pattern.test(path))) return null;
    const permission = Router.permission(path);
    return !permission || window.CurrentUser?.permissions.includes(permission) ? path : null;
  };
  function kind(error) {
    if (error?.statusCode === 403) return 'forbidden';
    if (error?.statusCode === 404) return 'notFound';
    if ([502, 503, 504].includes(error?.statusCode)) return 'unavailable';
    if (!navigator.onLine) return 'offline';
    if (error?.statusCode === 408 || error?.code === 'REQUEST_TIMEOUT') return 'timeout';
    if (error?.code === 'NETWORK_ERROR') return 'connection';
    return 'server';
  }
  function card(type, {error, heading = 'h2', title, actions = [], inline = false, id = type} = {}) {
    const [tone, icon, code, subject, description] = states[type];
    const ref = [error?.errorId, error?.requestId].find(value =>
      typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value));
    const status = code || (type === 'server' && error?.statusCode >= 500 ? error.statusCode : '');
    const details = ref ? '<details class="wms-exception-details"><summary>' +
      t('故障编号与排查信息', 'Error reference and troubleshooting') +
      '</summary><div class="wms-exception-actions"><code>' + escape(ref) +
      '</code><button class="button secondary" type="button" data-exception-action="copy">' +
      t('复制故障编号', 'Copy error reference') + '</button></div></details>' : '';
    const sysCode = heading === 'h2' && !inline ? ' data-sys-code="' + (type === 'forbidden' ? 'SYS-14' : 'SYS-15') + '"' : '';
    return '<section class="wms-exception ' + (inline ? 'wms-exception-inline' : 'wms-route-error') +
      '" data-exception="' + type + '" data-tone="' + tone + '" aria-labelledby="exception-title-' + id + '"' + sysCode + ' data-no-i18n>' +
      '<div class="wms-exception-message"><div class="wms-exception-top">' +
      '<span class="wms-exception-icon" aria-hidden="true">' + icon + '</span>' +
      (status ? '<span class="wms-exception-code">HTTP ' + escape(status) + '</span>' : '') +
      '</div><' + heading + ' id="exception-title-' + id + '" tabindex="-1">' + escape(title || t(...subject)) +
      '</' + heading + '><p>' + t(...description) + '</p><div class="wms-exception-actions">' +
      actions.map(({key, label, href}, index) => {
        const style = ' class="button ' + (index === 0 ? 'primary' : 'secondary') + '"';
        return href ? '<a' + style + ' href="' + escape(href) + '">' + escape(label) + '</a>' :
          '<button' + style + ' type="button" data-exception-action="' + key + '">' + escape(label) + '</button>';
      }).join('') + '</div>' + details + '<div class="wms-exception-result" role="status" hidden></div></div></section>';
  }
  function bind(panel, handlers) {
    if (!panel) return;
    const result = panel.querySelector('.wms-exception-result');
    const show = message => {
      result.textContent = message;
      result.hidden = false;
    };
    for (const button of panel.querySelectorAll('[data-exception-action]')) {
      button.onclick = async () => {
        const key = button.dataset.exceptionAction;
        button.disabled = true;
        try {
          if (key === 'copy') {
            await navigator.clipboard.writeText(panel.querySelector('code').textContent);
            show(t('已复制故障编号。', 'Error reference copied.'));
          } else if (handlers[key]) {
            const feedback = await handlers[key]();
            if (feedback) show(feedback);
          }
        } catch {
          show(key === 'copy' ? t('请选择上方编号并手动复制。', 'Select the reference above to copy it manually.') :
            t('暂时无法完成查询，请稍后再试。', 'The query could not be completed. Try again in a moment.'));
        } finally {
          button.disabled = false;
        }
      };
    }
  }
  const reload = () => location.reload();
  function entry(type, {error, onSignIn} = {}) {
    window.AppSignedIn = false;
    document.body.classList.add('boot-pending', 'wms-exception-entry-visible');
    element('login-panel').hidden = true;
    for (const node of document.querySelectorAll('.workspace,.sidebar')) node.inert = true;
    const box = element('session-restore');
    box.hidden = false;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', t('系统状态', 'System status'));
    const actions = onSignIn ? [action('signIn', '重新登录', 'Sign in again')] :
      [type === 'offline' ? action('retry', '检查连接', 'Check connection') :
        type === 'unavailable' ? action('retry', '重新连接', 'Reconnect') : action('retry', '重新加载', 'Reload page')];
    box.innerHTML = '<header class="wms-exception-brand" data-no-i18n>' +
      '<img src="/assets/metorex-ruashi-logo.png" alt="METOREX · Ruashi Mining" width="38" height="36">' +
      '<div><strong>' + t('产品仓储管理系统', 'Product WMS') + '</strong><small>' +
      t('穆松尼项目', 'Musonoi Project') + '</small></div></header><div class="wms-exception-entry-body">' +
      card(type, {error, heading: 'h1', actions}) + '</div>';
    bind(box.querySelector('.wms-exception'), {
      signIn: onSignIn,
      retry: () => type === 'offline' && !navigator.onLine ?
        t('连接仍未恢复。请检查设备网络后再试。', 'Still offline. Check your network and try again.') : reload()
    });
    box.querySelector('h1').focus();
  }
  function clearEntry() {
    const box = element('session-restore');
    document.body.classList.remove('wms-exception-entry-visible');
    box.hidden = true;
    box.removeAttribute('aria-label');
    box.setAttribute('role', 'status');
    box.replaceChildren();
  }
  function route(error) {
    if (!window.AppSignedIn) return;
    const type = kind(error);
    const target = workspace(), list = type === 'notFound' && backToList();
    const exit = {...action('home', '返回工作台', 'Back to workspace'), href: target};
    const actions = type === 'forbidden' ? [exit] : type === 'notFound' ?
      [list ? {...action('list', '返回列表', 'Back to list'), href: list} : exit] :
      [action('retry', '重新查询', 'Retry query'), exit];
    const area = document.querySelector('.breadcrumb strong')?.textContent;
    Router.page(area || t('仓储管理', 'Warehouse Management'), card(type, {error, actions}));
    const panel = element('page-content').querySelector('.wms-exception');
    bind(panel, {retry: () => Router.show()});
    requestAnimationFrame(() => panel.querySelector('h2')?.focus());
  }
  function query(host, error, retry, editFilters) {
    const type = kind(error);
    const title = type === 'timeout' ? t('库存查询超时', 'Stock query timed out') :
      type === 'server' ? t('库存页面加载失败', 'Stock page could not load') : undefined;
    const actions = [action('retry', '重新查询', 'Retry query')];
    if (type === 'timeout' && editFilters) actions.push(action('filters', '调整筛选', 'Edit filters'));
    host.innerHTML = card(type, {title, error, actions, inline: true, id: 'stock-query'});
    bind(host.firstElementChild, {retry, filters: editFilters});
  }
  function arrival(form, type, handlers) {
    form.querySelector('[data-exception-arrival]')?.remove();
    const host = document.createElement('div');
    host.dataset.exceptionArrival = '';
    const actions = type === 'conflict' ? [action('latest', '查看最新记录', 'View latest record')] :
      [action('check', '查询提交结果', 'Check submission result')];
    host.innerHTML = card(type, {heading: 'h3', actions, inline: true, id: 'arrival'});
    form.querySelector('.wms-arrival-actions').before(host);
    bind(host.firstElementChild, handlers);
    host.querySelector('h3').focus();
    return host;
  }
  window.WmsException = {entry, clearEntry, route, query, arrival, kind};
  window.addEventListener('DOMContentLoaded', () => {
    if (!window.ClientRelease || !window.WmsBootStarted) entry(navigator.onLine ? 'startup' : 'offline');
  });
})();
