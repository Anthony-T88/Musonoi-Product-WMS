'use strict';

const DB = require('./database-connection.cjs');
const { display } = require('./business-time.cjs');
const reportKinds = new Set(['shipping', 'movement', 'balance', 'stocktake', 'sales']);
const products = new Set(['CU_CATHODE', 'CO_HYDROXIDE']);
const addressKey = value => typeof value === 'string' ? value.toLowerCase() : value;
const testMailbox = value => mailbox(value) && value.toLowerCase().endsWith('.test');
const accountId = value => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const scheduleEnabled = schedule => schedule.enabled !== false;

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
    const explicitState = schedule && Object.hasOwn(schedule, 'enabled');
    const fields = ['id', 'hour', 'frequency', 'actor', accounts ? 'recipientAccounts' : 'recipients', 'reports'];
    if (explicitState) fields.push('enabled');
    if (!hasKeys(schedule, fields) || (explicitState && typeof schedule.enabled !== 'boolean') ||
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
          (allowlist && scheduleEnabled(schedule) && !schedule.recipients.every(address => allowlist.has(addressKey(address))))) {
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

function effectivePolicy(config, policy) {
  if (policy.version !== 0) return policy;
  const schedules = config?.schedules ?? [];
  validateSchedules(schedules, {
    environment: config?.environment, allowlist: config ? new Set(config.recipientAllowlist.map(addressKey)) : undefined,
    enabled: false, accountsAllowed: false
  });
  return { ...policy, schedules, enabled: schedules.length > 0 };
}

const localDate = now => display(now).slice(0, 10).replaceAll('/', '-');
// Africa/Lubumbashi uses UTC+02:00 throughout the scheduling year.
const scheduledTime = (day, hour) => new Date(day + 'T' + String(hour).padStart(2, '0') + ':00:00+02:00');

function duePeriod(schedule, now) {
  if (!scheduleEnabled(schedule)) return null;
  const day = localDate(now);
  if (new Date(now) < scheduledTime(day, schedule.hour) ||
      (schedule.frequency === 'monthly' && !day.endsWith('-01'))) return null;
  const previousDay = new Date(day + 'T00:00:00Z');
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = previousDay.toISOString().slice(0, 10);
  return schedule.frequency === 'monthly'
    ? { key: yesterday.slice(0, 7), from: yesterday.slice(0, 7) + '-01', to: yesterday }
    : { key: yesterday, from: yesterday, to: yesterday };
}

function nextDelivery(policy, now = new Date()) {
  if (!policy.enabled) return null;
  const day = localDate(now);
  const current = new Date(now).getTime();
  let next = null;
  for (const schedule of policy.schedules.filter(scheduleEnabled)) {
    const monthly = schedule.frequency === 'monthly';
    const today = scheduledTime(day, schedule.hour);
    let upcoming = today;
    if (today.getTime() < current || (monthly && !day.endsWith('-01'))) {
      const later = new Date(day + 'T00:00:00Z');
      if (monthly) later.setUTCMonth(later.getUTCMonth() + 1, 1);
      else later.setUTCDate(later.getUTCDate() + 1);
      upcoming = scheduledTime(later.toISOString().slice(0, 10), schedule.hour);
    }
    const at = upcoming.toISOString();
    if (!next || at < next.at) next = { at, scheduleIds: [schedule.id] };
    else if (at === next.at) next.scheduleIds.push(schedule.id);
  }
  return next;
}

async function recipientAccounts(c, ids, { includeMissing = false } = {}) {
  const { rows } = await c.query(
    'SELECT id,username,display_name AS "displayName",contact_email AS email FROM users ' +
    'WHERE active AND deleted_at IS NULL ' +
    (includeMissing ? '' : 'AND contact_email IS NOT NULL ') +
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

module.exports = { addressKey, testMailbox, hasKeys, uniqueArray, mailbox, scheduleEnabled, validateSchedules,
  effectivePolicy, duePeriod, nextDelivery, recipientAccounts, readPolicy };
