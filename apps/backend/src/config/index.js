require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const config = {
  port: Number(process.env.PORT) || 5002,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/omsking',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  channelEncryptionKey: process.env.CHANNEL_ENCRYPTION_KEY || '',
  mail: {
    user: process.env.GMAIL_USER || '',
    pass: process.env.GMAIL_APP_PASSWORD || '',
    from: process.env.MAIL_FROM || process.env.GMAIL_USER || '',
  },
};

module.exports = config;
