const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const config = require('./config');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');
const { requestContext } = require('./lib/tenantContext');
const { healthCheck } = require('./controllers/v1Health.controller');

const v1Routes = require('./routes/v1');

const app = express();

app.use(cors({
  origin(origin, cb) {
    const allowed = config.corsOrigins || [];
    // Non-browser clients (curl, server-to-server) send no Origin
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(requestContext);

if (config.nodeEnv !== 'production') {
  app.use(morgan('dev'));
}

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to OMSKing API',
    service: 'OMSKing Backend',
    health: '/health',
    docs: '/api/v1',
  });
});

app.get('/health', healthCheck);
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'OMSKing API root',
    service: 'OMSKing Backend',
    health: '/health',
    v1: '/api/v1',
    routes: [
      'GET  /health',
      'GET  /api/v1',
      'POST /api/v1/auth/login',
      'GET  /api/v1/products',
      'GET  /api/v1/inventory',
      'GET  /api/v1/channels',
    ],
  });
});
app.get('/api/health', healthCheck);

app.use('/api/v1', v1Routes);

app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
