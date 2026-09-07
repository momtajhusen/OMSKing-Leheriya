const mongoose = require('mongoose');
const config = require('../config');

const connectDB = async () => {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log(`[DB] Connected to MongoDB: ${config.mongodbUri}`);
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
