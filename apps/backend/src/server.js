const app = require('./app');
const config = require('./config');
const connectDB = require('./db/connect');

const startServer = async () => {
  await connectDB();
  const host = process.env.HOST || '0.0.0.0';
  app.listen(config.port, host, () => {
    console.log(`[SERVER] OMSKing backend listening on ${host}:${config.port}`);
    console.log(`[SERVER] Environment: ${config.nodeEnv}`);
    console.log(`[SERVER] Health: http://127.0.0.1:${config.port}/health`);
    console.log(`[SERVER] API:    http://127.0.0.1:${config.port}/api/v1`);
  });
};

startServer();
