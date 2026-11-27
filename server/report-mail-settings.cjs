'use strict';

const Business = require('./business-common.cjs');
const Lease = require('./authorization-lease.cjs');
const Security = require('./management-security.cjs');
const Policy = require('./report-mail-policy.cjs');
const Transport = require('./report-mail-transport.cjs');
const path = '/api/v1/system/report-mail';
const permission = 'system:manage';

function administrator(permitted) {
  return async req => {
    await permitted(permission)(req);
    Security.systemAdministrator(req.user);
  };
}

async function eligibleActors(c) {
  const { rows } = await c.query(`
    SELECT u.username,u.display_name AS "displayName"
    FROM users u
    WHERE u.active AND u.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id)
      AND (SELECT count(*) FROM role_permissions p WHERE p.role_code=u.role_code
        AND p.permission_code IN ('report:read','inventory:export'))=2
    ORDER BY u.username
  `);
  return rows;
}

function validate(body, environment) {
  if (!Policy.hasKeys(body, ['version', 'enabled', 'schedules']) ||
      !Number.isInteger(body.version) || body.version < 0 || typeof body.enabled !== 'boolean') {
    throw Business.error(400, '报表邮件设置无效');
  }
  try {
    Policy.validateSchedules(body.schedules, { environment, enabled: body.enabled });
  } catch (error) {
    const messages = {
      REPORT_MAIL_CONFIG_INVALID: '请设置有效的发送计划，最多 20 项',
      REPORT_MAIL_SCHEDULE_INVALID: '请检查发送时间、执行账号、收件人和报表数量',
      REPORT_MAIL_TEST_DESTINATION_FORBIDDEN: '测试环境仅允许使用 .test 域名收件地址',
      REPORT_MAIL_REPORT_INVALID: '报表或产品无效，库存平衡和销售报表仅支持按月发送'
    };
    if (!messages[error.code]) throw error;
    throw Business.error(400, messages[error.code]);
  }
  return body;
}

const auditSummary = policy => ({
  enabled: policy.enabled,
  version: policy.version,
  schedule_count: policy.schedules.length,
  recipient_count: new Set(policy.schedules.flatMap(schedule => schedule.recipientAccounts ||
    schedule.recipients.map(Policy.addressKey))).size
});

function eligibleRecipient(host, environment, account) {
  return Policy.mailbox(account.email) && (environment !== 'test' || Policy.testMailbox(account.email)) &&
    (!host || Transport.approvedRecipient(host, account.email));
}

function publicTransport(row, host, canConfigure) {
  return {
    version: row.version,
    url: row.url || host?.smtp.url || '',
    from: row.from || host?.smtp.from || '',
    username: row.username || '',
    hasPassword: !!row.sealedPassword,
    relays: host?.allowedSmtpUrls || [],
    senders: host?.senderAllowlist || [],
    canConfigure
  };
}

async function transportKey(env) {
  return Transport.readKey(env).catch(() => null);
}

function validateTransport(body, host) {
  const required = ['version', 'url', 'from', 'username'];
  const hasPassword = body && Object.hasOwn(body, 'password');
  if (!Policy.hasKeys(body, hasPassword ? [...required, 'password'] : required) ||
      !Number.isInteger(body.version) || body.version < 0 || !host.allowedSmtpUrls.includes(body.url) ||
      !Transport.approvedSender(host, body.url, body.from) || !Transport.credential(body.username, 254) ||
      (hasPassword && !Transport.credential(body.password, 512))) {
    throw Business.error(400, '请选择已批准的邮件服务器和发件邮箱，并核对登录账号及邮箱凭据');
  }
  return body;
}

function register({ app, pool, cfg, permitted, csrf, env = process.env }) {
  const preHandler = administrator(permitted);
  app.get(path, { preHandler }, (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return Security.read(pool, req, permission, async (c, actor) => {
      Security.systemAdministrator(actor);
      const host = await Transport.readHost(env, cfg.environment).catch(() => null);
      const key = host ? await transportKey(env) : null;
      if (key) key.fill(0);
      const transport = publicTransport(await Transport.readTransport(c), host, !!key);
      const recipientAccounts = (await Policy.recipientAccounts(c))
        .filter(account => eligibleRecipient(host, cfg.environment, account));
      return { ...await Policy.readPolicy(c), actors: await eligibleActors(c), environment: cfg.environment,
        recipientAccounts, transport };
    });
  });
  app.put(path, { preHandler: [preHandler, csrf], bodyLimit: 65_536 }, (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const next = validate(req.body, cfg.environment);
    return Business.mutate(pool, req, async c => {
      const actor = await Security.actor(c, req, permission);
      Security.systemAdministrator(actor);
      const { rows: [old] } = await c.query('SELECT version,enabled,schedules FROM report_mail_settings WHERE singleton FOR UPDATE');
      if (!old || old.version !== next.version) throw Business.error(409, '报表邮件设置已更新，请重新打开页面核对');
      if (next.enabled) {
        const allowed = new Set((await eligibleActors(c)).map(account => account.username));
        if (next.schedules.some(schedule => !allowed.has(schedule.actor))) {
          throw Business.error(400, '请为每项发送计划选择仍拥有报表查看、导出及数据范围的账号');
        }
        const ids = [...new Set(next.schedules.flatMap(schedule => schedule.recipientAccounts || []))];
        if (ids.length) {
          const host = await Transport.readHost(env, cfg.environment).catch(() => {
            throw Business.error(503, '服务器邮件安全策略无法读取，请联系运维');
          });
          const accounts = await Policy.recipientAccounts(c, ids);
          if (accounts.length !== ids.length || accounts.some(account => !eligibleRecipient(host, cfg.environment, account))) {
            throw Business.error(400, '请选择仍启用且注册邮箱符合发送规则的收件账号');
          }
        }
      }
      const { rows: [saved] } = await c.query(
        `UPDATE report_mail_settings
         SET enabled=$1,schedules=$2,version=version+1,updated_by=$3,updated_at=clock_timestamp()
         WHERE singleton RETURNING version,enabled,updated_at AS "updatedAt"`,
        [next.enabled, JSON.stringify(next.schedules), actor.id]
      );
      await Business.audit(c, req, 'report_mail_settings_updated', 'settings', 'report_mail',
        auditSummary(old), auditSummary({ ...saved, schedules: next.schedules }));
      return saved;
    });
  });
  app.put(path + '/transport', { preHandler: [preHandler, csrf], bodyLimit: 4096 }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const host = await Transport.readHost(env, cfg.environment).catch(() => null);
    if (!host) throw Business.error(503, '邮件服务器尚未完成主机配置，请联系运维');
    const next = validateTransport(req.body, host);
    const key = await transportKey(env);
    if (!key) throw Business.error(503, '邮件加密密钥尚未配置，请联系运维');
    let c;
    try {
      c = await pool.connect();
      await c.query('BEGIN');
      await Lease.lockBusiness(c, req);
      const actor = await Security.actor(c, req, permission);
      Security.systemAdministrator(actor);
      const { rows: [old] } = await c.query(
        'SELECT version,smtp_url AS url,sender AS "from",login_name AS username,sealed_password AS "sealedPassword" ' +
        'FROM report_mail_transport WHERE singleton FOR UPDATE'
      );
      if (!old || old.version !== next.version) throw Business.error(409, '邮件服务器设置已更新，请重新打开页面核对');
      if (!next.password) {
        if (!old.sealedPassword || old.url !== next.url || old.from !== next.from || old.username !== next.username) {
          throw Business.error(400, '首次配置或更改邮件服务器、发件邮箱、登录账号时，请输入邮箱凭据');
        }
        await c.query('COMMIT');
        return publicTransport(old, host, true);
      }
      const sealedPassword = Transport.seal(next.password, next, key);
      const { rows: [saved] } = await c.query(
        'UPDATE report_mail_transport SET smtp_url=$1,sender=$2,login_name=$3,sealed_password=$4,' +
        'version=version+1,updated_by=$5,updated_at=clock_timestamp() WHERE singleton ' +
        'RETURNING version,smtp_url AS url,sender AS "from",login_name AS username,sealed_password AS "sealedPassword"',
        [next.url, next.from, next.username, sealedPassword, actor.id]
      );
      await Business.audit(c, req, 'report_mail_transport_updated', 'settings', 'report_mail',
        { version: old.version }, { version: saved.version });
      Lease.healthy(req);
      await c.query('COMMIT');
      return publicTransport(saved, host, true);
    } catch (error) {
      if (c) await c.query('ROLLBACK');
      throw error;
    } finally {
      key.fill(0);
      if (c) c.release();
    }
  });
}

module.exports = { administrator, register, path };
