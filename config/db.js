const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../logger');

let pool;

async function createPoolWithRetry(retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      pool = mysql.createPool({
        host: process.env.DB_HOST || 'mysql.railway.internal',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'railway',
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });

      const connection = await pool.getConnection();
      logger.info('Database connected successfully', {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
      });
      connection.release();
      return pool;
    } catch (err) {
      logger.error('Database connection attempt failed', {
        error: err.message,
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        database: process.env.DB_NAME,
        attempt: i + 1,
      });
      if (i < retries - 1) {
        logger.info(`Retrying connection in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

try {
  createPoolWithRetry().catch(err => {
    logger.error('Error initializing database pool', {
      error: err.message,
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
    });
    process.exit(1);
  });
} catch (err) {
  logger.error('Error initializing database pool', {
    error: err.message,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
  });
  process.exit(1);
}

module.exports = pool;