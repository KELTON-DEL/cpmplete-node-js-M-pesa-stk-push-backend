'use strict'

exports.config = {
  app_name: ['mpesa-stk-backend'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY || 'not-a-real-key',
  logging: {
    level: 'info'
  },
  allow_all_headers: true,
  rules: {
    ignore: ['/health']
  }
}