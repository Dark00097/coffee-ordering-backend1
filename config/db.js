const mysql = require('mysql2/promise');
require('dotenv').config();
const logger = require('../logger');

let pool;

async function createPoolWithRetry(retries = 5, delay = 3000) {
  const hosts = [
    {
      host: process.env.DB_HOST || 'mysql.railway.internal',
      port: process.env.DB_PORT || 3306,
      type: 'internal',
    },
    {
      host: process.env.DB_PUBLIC_HOST || 'caboose.proxy.rlwy.net',
      port: process.env.DB_PUBLIC_PORT || 29085,
      type: 'public',
    },
  ];

  for (let i = 0; i < hosts.length; i++) {
    const { host, port, type } = hosts[i];
    logger.info(`Starting connection attempts to ${type} host`, { host, port });
    let success = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        pool = mysql.createPool({
          host,
          port,
          user: process.env.DB_USER || 'root',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'railway',
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
        });

        const connection = await pool.getConnection();
        logger.info(`Database connected successfully via ${type} host`, {
          host,
          port,
          database: process.env.DB_NAME,
        });
        connection.release();
        success = true;
        break;
      } catch (err) {
        logger.error(`Connection attempt ${attempt} failed via ${type} host`, {
          error: err.message,
          host,
          port,
          user: process.env.DB_USER,
          database: process.env.DB_NAME,
        });
        if (attempt < retries) {
          logger.info(`Retrying ${type} host in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    if (success) break;
    if (i < hosts.length - 1) {
      logger.info(`Exhausted retries for ${type} host, moving to next host...`);
    }
  }

  if (!pool) {
    throw new Error('All database connection attempts failed');
  }

  return pool;
}

(async () => {
  try {
    pool = await createPoolWithRetry();
  } catch (err) {
    logger.error('Failed to initialize database pool', {
      error: err.message,
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
    });
    process.exit(1);
  }
})();

module.exports = {
  getConnection: () => pool.getConnection(),
  query: (...args) => pool.query(...args),
};