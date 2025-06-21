const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../logger');
const { query, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const checkAdminOrServer = async (user) => {
  if (!user) return false;
  return ['admin', 'server'].includes(user.role);
};

router.get('/notifications', [
  query('is_read').optional().isIn(['0', '1']).withMessage('is_read must be 0 or 1'),
], async (req, res) => {
  const errors = validationResult(req);
  const { is_read } = req.query;
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();

  if (!errors.isEmpty()) {
    logger.warn('Validation errors for fetching notifications', { errors: errors.array(), sessionId, timestamp });
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    if (!user || !(await checkAdminOrServer(user))) {
      logger.warn('Unauthorized access attempt to notifications', { userId: user?.id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin or server access required' });
    }

    let query = 'SELECT * FROM notifications WHERE type = ?';
    const queryParams = ['order'];

    if (is_read !== undefined) {
      query += ' AND is_read = ?';
      queryParams.push(parseInt(is_read));
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await db.query(query, queryParams);
    logger.info('Notifications fetched', { count: rows.length, userId: user.id, sessionId, timestamp });
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching notifications', {
      error: error.message,
      stack: error.stack,
      userId: user?.id,
      sessionId,
      timestamp,
    });
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.put('/notifications/:id/read', [
  param('id').isInt({ min: 1 }).withMessage('Valid notification ID is required'),
], async (req, res) => {
  const errors = validationResult(req);
  const { id } = req.params;
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();

  if (!errors.isEmpty()) {
    logger.warn('Validation errors for marking notification as read', { errors: errors.array(), sessionId, timestamp });
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    if (!user || !(await checkAdminOrServer(user))) {
      logger.warn('Unauthorized attempt to mark notification as read', { userId: user?.id, notificationId: id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin or server access required' });
    }

    const [notificationRows] = await db.query('SELECT * FROM notifications WHERE id = ?', [id]);
    if (notificationRows.length === 0) {
      logger.warn('Notification not found', { notificationId: id, userId: user.id, sessionId, timestamp });
      return res.status(404).json({ error: 'Notification not found' });
    }

    await db.query('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
    const [updatedNotification] = await db.query('SELECT * FROM notifications WHERE id = ?', [id]);
    io.to(`user-${user.id}`).emit('notification-updated', updatedNotification[0]);
    logger.info('Notification marked as read', { notificationId: id, userId: user.id, sessionId, timestamp });
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Error marking notification as read', {
      error: error.message,
      stack: error.stack,
      notificationId: id,
      userId: user?.id,
      sessionId,
      timestamp,
    });
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.put('/notifications/clear', async (req, res) => {
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();

  try {
    if (!user || !(await checkAdminOrServer(user))) {
      logger.warn('Unauthorized attempt to clear notifications', { userId: user?.id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin or server access required' });
    }

    await db.query('UPDATE notifications SET is_read = 1 WHERE is_read = 0 AND type = ?', ['order']);
    io.to(`user-${user.id}`).emit('notifications-cleared', { type: 'order' });
    logger.info('Notifications cleared', { userId: user.id, sessionId, timestamp });
    res.json({ message: 'Notifications cleared' });
  } catch (error) {
    logger.error('Error clearing notifications', {
      error: error.message,
      stack: error.stack,
      userId: user?.id,
      sessionId,
      timestamp,
    });
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

module.exports = (io) => router;