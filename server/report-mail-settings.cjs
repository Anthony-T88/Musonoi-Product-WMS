'use strict';

const Business = require('./business-common.cjs');
const Security = require('./management-security.cjs');
const Policy = require('./report-mail-policy.cjs');
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
  recipient_count: new Set(policy.schedules.flatMap(schedule => schedule.recipients.map(Policy.addressKey))).size
});

function register({ app, pool, cfg, permitted, csrf }) {
  const preHandler = administrator(permitted);
  app.get(path, { preHandler }, (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return Security.read(pool, req, permission, async (c, actor) => {
      Security.systemAdministrator(actor);
      return { ...await Policy.readPolicy(c), actors: await eligibleActors(c), environment: cfg.environment };
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
}

module.exports = { administrator, register, path };
