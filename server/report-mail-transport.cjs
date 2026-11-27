'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const DB = require('./database-connection.cjs');
const Policy = require('./report-mail-policy.cjs');

function smtpUrl(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\s\u0000-\u001f\u007f]/.test(value)) {
    DB.fail('REPORT_MAIL_SMTP_INVALID');
  }
  let url;
  try { url = new URL(value); } catch { DB.fail('REPORT_MAIL_SMTP_INVALID'); }
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.port || url.username || url.password ||
      url.search || url.hash || !['', '/'].includes(url.pathname) || !/^[a-z0-9][a-z0-9.-]*$/i.test(url.hostname)) {
    DB.fail('REPORT_MAIL_SMTP_INVALID');
  }
  return { key: url.protocol + '//' + url.host.toLowerCase(), host: url.hostname };
}

function validateHost(value, environment) {
  if (!['test', 'production'].includes(environment)) DB.fail('REPORT_MAIL_INVALID_ENVIRONMENT');
  const optional = new Set(['schedules', 'allowedSmtpUrls', 'senderAllowlist', 'recipientDomains']);
  if (!value || !Policy.hasKeys(value, ['smtp', 'recipientAllowlist', ...Object.keys(value).filter(key => optional.has(key))]) ||
      !Policy.hasKeys(value.smtp, ['url', 'from']) || !Policy.mailbox(value.smtp.from)) DB.fail('REPORT_MAIL_CONFIG_INVALID');

  const { recipientAllowlist, recipientDomains = [], senderAllowlist = [value.smtp.from],
    allowedSmtpUrls = [value.smtp.url] } = value;
  if (!Policy.uniqueArray(recipientDomains, 30, Policy.addressKey, 0) ||
      !recipientDomains.every(domain => typeof domain === 'string' && !domain.includes('@') && Policy.mailbox('mail@' + domain)) ||
      !Policy.uniqueArray(recipientAllowlist, 100, Policy.addressKey, recipientDomains.length ? 0 : 1) ||
      !recipientAllowlist.every(Policy.mailbox) ||
      !Policy.uniqueArray(senderAllowlist, 30, Policy.addressKey) || !senderAllowlist.every(Policy.mailbox) ||
      !Policy.uniqueArray(allowedSmtpUrls, 20)) DB.fail('REPORT_MAIL_CONFIG_INVALID');

  const defaultRelay = smtpUrl(value.smtp.url);
  const approvedRelays = allowedSmtpUrls.map(smtpUrl);
  if (!Policy.uniqueArray(approvedRelays, 20, relay => relay.key) ||
      !approvedRelays.some(relay => relay.key === defaultRelay.key) ||
      !senderAllowlist.some(sender => Policy.addressKey(sender) === Policy.addressKey(value.smtp.from))) {
    DB.fail('REPORT_MAIL_CONFIG_INVALID');
  }
  if (environment === 'test' && ([defaultRelay, ...approvedRelays].some(relay => relay.host !== '127.0.0.1') ||
      ![value.smtp.from, ...senderAllowlist, ...recipientAllowlist, ...recipientDomains.map(domain => 'mail@' + domain)]
        .every(Policy.testMailbox))) DB.fail('REPORT_MAIL_TEST_DESTINATION_FORBIDDEN');

  return {
    ...value, environment,
    smtp: { from: value.smtp.from, url: defaultRelay.key },
    allowedSmtpUrls: approvedRelays.map(relay => relay.key),
    senderAllowlist, recipientDomains
  };
}

function approvedRecipient(config, mailbox, legacy = false) {
  if (!Policy.mailbox(mailbox)) return false;
  const address = Policy.addressKey(mailbox);
  return config.recipientAllowlist.some(allowed => Policy.addressKey(allowed) === address) ||
    (!legacy && (config.recipientDomains ?? []).some(domain => Policy.addressKey(domain) === address.split('@')[1]));
}

function approvedSender(config, url, from) {
  return config.allowedSmtpUrls.includes(smtpUrl(url).key) && Policy.mailbox(from) &&
    config.senderAllowlist.includes(from);
}

async function checkedPath(file, directory, mask) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) DB.fail('REPORT_MAIL_PRIVATE_PATH_REQUIRED');
  const stat = await fs.lstat(file);
  if ((directory ? !stat.isDirectory() : !stat.isFile()) ||
      (process.platform !== 'win32' && (stat.mode & mask) !== 0)) DB.fail('REPORT_MAIL_PRIVATE_PATH_INVALID');
  return stat;
}

async function readHost(env, environment) {
  if (!env.WMS_REPORT_MAIL_CONFIG_FILE) return null;
  const file = env.WMS_REPORT_MAIL_CONFIG_FILE;
  const stat = await checkedPath(file, false, 0o022);
  if (stat.size > 65_536) DB.fail('REPORT_MAIL_CONFIG_INVALID');
  let input;
  try { input = JSON.parse(await fs.readFile(file, 'utf8')); } catch { DB.fail('REPORT_MAIL_CONFIG_INVALID'); }
  return validateHost(input, environment);
}

async function readKey(env) {
  const file = env.WMS_REPORT_MAIL_KEY_FILE;
  try {
    const stat = await checkedPath(file, false, 0o077);
    if (stat.size < 64 || stat.size > 66) DB.fail('REPORT_MAIL_KEY_INVALID');
    const hex = (await fs.readFile(file, 'ascii')).trim();
    if (!/^[a-f0-9]{64}$/i.test(hex)) DB.fail('REPORT_MAIL_KEY_INVALID');
    return Buffer.from(hex, 'hex');
  } catch {
    DB.fail('REPORT_MAIL_KEY_INVALID');
  }
}

const credential = (value, max) => typeof value === 'string' &&
  value.length >= 1 && value.length <= max && /^[\x20-\x7e]+$/.test(value) && value.trim() === value;

function additionalData({ url, from, username }) {
  return Buffer.from(JSON.stringify(['musonoi-report-mail-v1', url, from, username]));
}

function seal(password, transport, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(additionalData(transport));
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function open(encrypted, transport, key) {
  try {
    const data = Buffer.from(encrypted, 'base64');
    if (data.length < 29 || data.length > 540) DB.fail('REPORT_MAIL_CREDENTIAL_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(additionalData(transport));
    decipher.setAuthTag(data.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
    try {
      const value = plain.toString('utf8');
      if (!credential(value, 512)) DB.fail('REPORT_MAIL_CREDENTIAL_INVALID');
      return value;
    } finally {
      plain.fill(0);
    }
  } catch {
    DB.fail('REPORT_MAIL_CREDENTIAL_INVALID');
  }
}

async function readTransport(c) {
  const { rows: [row] } = await c.query(
    'SELECT version,smtp_url AS url,sender AS "from",login_name AS username,sealed_password AS "sealedPassword" FROM report_mail_transport WHERE singleton'
  );
  if (!row) DB.fail('REPORT_MAIL_TRANSPORT_MISSING');
  return row;
}

module.exports = {
  smtpUrl, validateHost, approvedRecipient, approvedSender, checkedPath, readHost,
  readKey, credential, seal, open, readTransport
};
