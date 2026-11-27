'use strict';

const DB = require('./database-connection.cjs');
const reportKinds = new Set(['shipping', 'movement', 'balance', 'stocktake', 'sales']);
const products = new Set(['CU_CATHODE', 'CO_HYDROXIDE']);
const addressKey = value => typeof value === 'string' ? value.toLowerCase() : value;
const testMailbox = value => mailbox(value) && value.toLowerCase().endsWith('.test');
const accountId = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

function hasKeys(object, expected) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === expected.length && expected.every(key => Object.hasOwn(object, key));
}

function uniqueArray(values, max, key = value => value, minimum = 1) {
  return Array.isArray(values) && values.length >= minimum && values.length <= max &&
    new Set(values.map(key)).size === values.length;
}

function mailbox(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  const [user, domain] = parts;
  return parts.length === 2 && user.length <= 64 && /^[a-zA-Z0-9_+-]+(?:\.[a-zA-Z0-9_+-]+)*$/.test(user) &&
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(domain);
}

function validateSchedules(schedules, { allowlist, environment, enabled = true, accountsAllowed = true } = {}) {
  if (!uniqueArray(schedules, 20, schedule => schedule?.id, enabled ? 1 : 0)) DB.fail('REPORT_MAIL_CONFIG_INVALID');
  for (const schedule of schedules) {
    const accounts = schedule && Object.hasOwn(schedule, 'recipientAccounts');
    if (!hasKeys(schedule, ['id', 'hour', 'frequency', 'actor', accounts ? 'recipientAccounts' : 'recipients', 'reports']) ||
        typeof schedule.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(schedule.id) ||
        !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 ||
        !['daily', 'monthly'].includes(schedule.frequency) ||
        typeof schedule.actor !== 'string' || !schedule.actor.trim() || schedule.actor.length > 160 ||
        schedule.actor.trim() !== schedule.actor || /[\u0000-\u001f\u007f]/.test(schedule.actor) ||
        !uniqueArray(schedule.reports, 6, report => [report?.kind,report?.product].join(':'))) {
      DB.fail('REPORT_MAIL_SCHEDULE_INVALID');
    }
    if (accounts) {
      if (!accountsAllowed || !uniqueArray(schedule.recipientAccounts, 8) ||
          !schedule.recipientAccounts.every(accountId)) DB.fail('REPORT_MAIL_SCHEDULE_INVALID');
    } else {
      if (!uniqueArray(schedule.recipients, 8, addressKey) || !schedule.recipients.every(mailbox) ||
          (allowlist && !schedule.recipients.every(address => allowlist.has(addressKey(address))))) {
        DB.fail('REPORT_MAIL_SCHEDULE_INVALID');
      }
      if (environment === 'test' && !schedule.recipients.every(testMailbox)) DB.fail('REPORT_MAIL_TEST_DESTINATION_FORBIDDEN');
    }
    for (const report of schedule.reports) {
      if (!hasKeys(report, ['kind', 'product']) || !reportKinds.has(report.kind) || !products.has(report.product) ||
          (schedule.frequency === 'daily' && ['balance', 'sales'].includes(report.kind))) {
        DB.fail('REPORT_MAIL_REPORT_INVALID');
      }
    }
  }
}

async function recipientAccounts(c, ids) {
  const { rows } = await c.query(
    'SELECT id,username,display_name AS "displayName",contact_email AS email FROM users ' +
    'WHERE active AND deleted_at IS NULL AND contact_email IS NOT NULL ' +
    (ids ? 'AND id=ANY($1::uuid[]) ' : '') + 'ORDER BY username',
    ids ? [ids] : []
  );
  return rows;
}

async function readPolicy(c) {
  const { rows: [row] } = await c.query(
    'SELECT version,enabled,schedules,updated_at AS "updatedAt" FROM report_mail_settings WHERE singleton'
  );
  if (!row) DB.fail('REPORT_MAIL_POLICY_MISSING');
  return row;
}

module.exports = { addressKey, testMailbox, hasKeys, uniqueArray, mailbox, validateSchedules, recipientAccounts, readPolicy };
