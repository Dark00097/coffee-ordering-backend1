const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const logger = require('./logger');
const db = require('./config/db');
const validate = require('./middleware/validate');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://offee-ordering-frontend1-production.up.railway.app',
  'http://localhost:5173',
  'http://192.168.1.13:5173',
  /^http:\/\/192\.168\.1\.\d{1,3}:5173$/,
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(allowed => typeof allowed === 'string' ? allowed === origin : allowed.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: '1d' }));

const io = new Server(server, { cors: corsOptions });

// Middleware to verify JWT for staff/admin
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const sessionId = req.headers['x-session-id'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
      req.user = decoded;
    } catch (err) {
      logger.warn('Invalid token', { error: err.message });
    }
  }
  req.sessionId = sessionId; // Store session ID for guests
  logger.info('Incoming request', {
    method: req.method,
    url: req.url,
    user: req.user ? req.user.id : 'guest',
    sessionId: sessionId || 'none',
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

// Validation middleware
app.use('/api', validate);

// Route to generate session ID for guests
app.get('/api/session', (req, res) => {
  const sessionId = req.sessionId || require('uuid').v4();
  res.json({ sessionId });
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

app.use((err, req, res, next) => {
  logger.error('Server error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    user: req.user ? req.user.id : 'guest',
    sessionId: req.sessionId || 'none',
    origin: req.headers.origin,
  });
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  logger.warn('Route not found', {
    method: req.method,
    url: req.url,
    user: req.user ? req.user.id : 'guest',
    sessionId: req.sessionId || 'none',
    origin: req.headers.origin,
  });
  res.status(404).json({ error: 'Not found' });
});

io.on('connection', (socket) => {
  logger.info('New socket connection', { id: socket.id });

  socket.on('join-session', (data) => {
    let sessionId, token;
    if (typeof data === 'string') {
      sessionId = data; // Guest session ID
    } else if (typeof data === 'object' && data.token) {
      token = data.token; // Staff/admin JWT
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        socket.join(decoded.id.toString());
        logger.info('Socket joined user room', { socketId: socket.id, userId: decoded.id });
        if (['admin', 'server'].includes(decoded.role)) {
          socket.join('staff-notifications');
          logger.info('Socket joined staff-notifications room', { socketId: socket.id, userId: decoded.id, role: decoded.role });
        }
      } catch (error) {
        logger.error('Error verifying token for socket', { error: error.message });
      }
    } else if (sessionId) {
      socket.join(`guest-${sessionId}`);
      logger.info('Socket joined guest room', { socketId: socket.id, sessionId });
    }
  });

  socket.on('disconnect', () => {
    logger.info('Socket disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', async () => {
  try {
    await db.getConnection();
    logger.info(`Server running on port ${PORT}`);
  } catch (error) {
    logger.error('Failed to connect to database', { error: error.message });
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