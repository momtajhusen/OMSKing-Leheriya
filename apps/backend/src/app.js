const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const config = require('./config');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

const v1Routes = require('./routes/v1');

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

if (config.nodeEnv !== 'production') {
  app.use(morgan('dev'));
}

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to OMSKing API',
    docs: '/api/v1',
  });
});

app.use('/api/v1', v1Routes);

app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
