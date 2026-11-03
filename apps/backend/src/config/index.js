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
  // Comma-separated list. Defaults include live admin so production works after pull.
  corsOrigins: String(
    process.env.CORS_ORIGIN
      || 'http://localhost:5173,https://omsking.codersalpha.com',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  channelEncryptionKey: process.env.CHANNEL_ENCRYPTION_KEY || '',
  demoLogin: process.env.DEMO_LOGIN === 'true' || (process.env.NODE_ENV || 'development') !== 'production',
  // A development backend sends Developer Support (/support) to the live API: the subscriber inbox as the live
  // developer account, the merchant chat as the live client account.
  supportLive: {
    url: process.env.SUPPORT_LIVE_API_URL || 'https://omskingapi.codersalpha.com/api/v1',
    email: process.env.SUPPORT_LIVE_EMAIL || '',
    password: process.env.SUPPORT_LIVE_PASSWORD || '',
    clientEmail: process.env.SUPPORT_LIVE_CLIENT_EMAIL || '',
    clientPassword: process.env.SUPPORT_LIVE_CLIENT_PASSWORD || '',
  },
  // Header Auto-fix button on localhost: runs the Cursor agent CLI on this machine. Never on a production backend.
  reportAutofix: {
    enabled: process.env.REPORT_AUTOFIX === 'true' && (process.env.NODE_ENV || 'development') !== 'production',
    agentBin: process.env.CURSOR_AGENT_BIN || require('path').join(require('os').homedir(), '.local/bin/cursor-agent'),
    model: process.env.REPORT_AUTOFIX_MODEL || '',
    repoDir: require('path').resolve(__dirname, '../../../..'),
    outDir: require('path').resolve(__dirname, '../../../../client-reports'),
    // Outside the repo, so the agent's edits never touch the folder the editor and nodemon use.
    worktreeRoot: process.env.REPORT_AUTOFIX_WORKTREES || require('path').join(require('os').homedir(), '.omsking-autofix'),
  },
  mail: {
    user: process.env.GMAIL_USER || '',
    pass: process.env.GMAIL_APP_PASSWORD || '',
    from: process.env.MAIL_FROM || process.env.GMAIL_USER || '',
  },
};

module.exports = config;
