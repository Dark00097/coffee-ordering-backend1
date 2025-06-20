const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const logger = require('./logger');
const db = require('./config/db');
const validate = require('./middleware/validate');

const app = express();
const server = http.createServer(app);

// Ensure CLIENT_URL is split into an array
const allowedOrigins = [
  ...(process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : ['http://localhost:5173']),
];

// Debug CORS origins
console.log('Allowed Origins:', allowedOrigins);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Allow requests with no origin (e.g., mobile apps)
    if (allowedOrigins.some(allowed => allowed === origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
};

app.use(cors(corsOptions));

// Ensure Socket.IO uses the same CORS settings
const io = new Server(server, {
  cors: corsOptions,
  path: '/socket.io/',
  serveClient: false,
});

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'mysql.railway.internal',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'railway',
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    key: 'session_cookie_name',
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 86400000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    },
  })
);

app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    user: req.session.user ? req.session.user.id : 'anonymous',
    sessionID: req.sessionID,
    origin: req.headers.origin,
  });
  next();
});

// Routes
const authRoutes = require('./routes/authRoutes');
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes')(io);
const reservationRoutes = require('./routes/reservationRoutes')(io);
const promotionRoutes = require('./routes/promotionRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const breakfastRoutes = require('./routes/breakfastRoutes');

app.use('/api', authRoutes);
app.use('/api', menuRoutes);
app.use('/api', orderRoutes);
app.use('/api', reservationRoutes);
app.use('/api', promotionRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', notificationRoutes);
app.use('/api', bannerRoutes);
app.use('/api', breakfastRoutes);

app.use('/api', (req, res, next) => {
  if (
    req.method === 'POST' ||
    req.method === 'PUT' ||
    req.method === 'DELETE' ||
    (req.method === 'GET' && (
      req.path.includes('/menu-items') ||
      req.path.includes('/categories') ||
      req.path.includes('/ratings') ||
      req.path.includes('/tables') ||
      req.path.includes('/notifications') ||
      req.path.includes('/banners') ||
      req.path.includes('/breakfasts')
    ))
  ) {
    if (req.path.includes('/menu-items') || req.path.includes('/categories') || req.path.includes('/banners') || req.path.includes('/breakfasts')) {
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        return next();
      }
    }
    return validate(req, res, next);
  }
  next();
});

function logRoutes() {
  app._router?.stack?.forEach((layer) => {
    if (layer.route) {
      logger.info('Registered route', {
        method: layer.route.stack[0].method.toUpperCase(),
        path: layer.route.path,
      });
    } else if (layer.name === 'router' && layer.handle.stack) {
      const prefix = layer.regexp.source
        .replace(/\\\//g, '/')
        .replace(/^\/\^/, '')
        .replace(/\/\?\(\?=\/\|\$\)/, '');
      layer.handle.stack.forEach((handler) => {
        if (handler.route) {
          logger.info('Registered route', {
            method: handler.route.stack[0].method.toUpperCase(),
            path: prefix + handler.route.path,
          });
        }
      });
    }
  });
}

logRoutes();

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    user: req.session.user ? req.session.user.id : 'anonymous',
    origin: req.headers.origin,
  });
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.use((req, res) => {
  logger.warn('Route not found', {
    method: req.method,
    url: req.url,
    user: req.session.user ? req.session.user.id : 'anonymous',
    origin: req.headers.origin,
  });
  res.status(404).json({ error: 'Not found' });
});

io.on('connection', (socket) => {
  logger.info('New socket connection', { id: socket.id });

  socket.on('join-session', async (sessionId) => {
    socket.join(sessionId);
    logger.info('Socket joined session room', { socketId: socket.id, sessionId });

    try {
      const [sessionData] = await db.query('SELECT data FROM sessions WHERE session_id = ?', [sessionId]);
      if (sessionData.length > 0) {
        const session = JSON.parse(sessionData[0].data);
        if (session && session.user && ['admin', 'server'].includes(session.user.role)) { // Added null checks
          socket.join('staff-notifications');
          logger.info('Socket joined staff-notifications room', { socketId: socket.id, sessionId, role: session.user.role });
        }
      }
    } catch (error) {
      logger.error('Error checking session for staff role', { error: error.message, sessionId });
    }
  });

  socket.on('disconnect', () => {
    logger.info('Socket disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 8080; // Match Railway's dynamic port
server.listen(PORT, '0.0.0.0', async () => {
  try {
    await db.getConnection();
    logger.info(`Server running on port ${PORT}`);
  } catch (error) {
    logger.error('Failed to start server due to database connection error', {
      error: error.message,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
    });
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason: reason.message || reason, promise });
});