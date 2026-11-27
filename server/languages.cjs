'use strict';

const supported = Object.freeze(['zh-CN', 'en', 'fr']);
const englishBase = language => language === 'en' || language === 'fr';

module.exports = { supported, englishBase };
