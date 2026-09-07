const app = require('./app');
const config = require('./config');
const connectDB = require('./db/connect');

const startServer = async () => {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`[SERVER] OMSKing backend running on port ${config.port}`);
    console.log(`[SERVER] Environment: ${config.nodeEnv}`);
    console.log(`[SERVER] API:    http://localhost:${config.port}/api/v1`);
  });
};

startServer();
