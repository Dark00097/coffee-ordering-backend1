const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../logger');
const multer = require('multer');
const path = require('path');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', 'public', 'Uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Image must be JPEG or PNG'), false);
    }
  },
}).single('image');

const checkAdmin = async (user) => {
  if (!user) return false;
  return user.role === 'admin';
};

// Create banner
router.post('/banners', [
  body('user_id').isInt({ min: 1 }).withMessage('Valid user ID is required'),
  body('link').notEmpty().trim().withMessage('Banner link is required'),
  body('is_enabled').optional().isBoolean().withMessage('is_enabled must be a boolean'),
], upload, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors for banner creation', { errors: errors.array(), sessionId: req.headers['x-session-id'], timestamp: new Date().toISOString() });
    return res.status(400).json({ errors: errors.array() });
  }
  const { user_id, link, is_enabled } = req.body;
  const image = req.file;
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();
  logger.info('Parsed banner creation request', {
    body: req.body,
    file: image ? { name: image.filename, path: image.path } : null,
    userId: user?.id,
    sessionId,
    timestamp,
  });
  try {
    if (!user || user.id !== parseInt(user_id) || !await checkAdmin(user)) {
      logger.warn('Unauthorized attempt to create banner', { user_id, userId: user?.id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (!image) {
      logger.warn('Missing banner image', { user_id, sessionId, timestamp });
      return res.status(400).json({ error: 'Banner image is required' });
    }
    const image_url = `/Uploads/${image.filename}`;
    const parsedIsEnabled = is_enabled === 'true' || is_enabled === true;
    const [result] = await db.query(
      'INSERT INTO banners (image_url, link, is_enabled, admin_id) VALUES (?, ?, ?, ?)',
      [image_url, link.trim(), parsedIsEnabled, user_id]
    );
    const [newBanner] = await db.query(
      'SELECT id, image_url, link, is_enabled, created_at, updated_at, admin_id FROM banners WHERE id = ?',
      [result.insertId]
    );
    io.to(`user-${user.id}`).emit('banner-created', newBanner[0]);
    if (parsedIsEnabled) {
      io.emit('banner-created', newBanner[0]);
    }
    logger.info('Banner created', { id: result.insertId, link, image_url, is_enabled: parsedIsEnabled, userId: user.id, sessionId, timestamp });
    res.status(201).json({ message: 'Banner created', id: result.insertId });
  } catch (error) {
    logger.error('Error creating banner', { error: error.message, body: req.body, userId: user?.id, sessionId, timestamp });
    res.status(500).json({ error: 'Failed to create banner' });
  }
});

// Update banner
router.put('/banners/:id', [
  param('id').isInt({ min: 1 }).withMessage('Valid banner ID is required'),
  body('user_id').isInt({ min: 1 }).withMessage('Valid user ID is required'),
  body('link').notEmpty().trim().withMessage('Banner link is required'),
  body('is_enabled').optional().isBoolean().withMessage('is_enabled must be a boolean'),
], upload, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors for banner update', { errors: errors.array(), sessionId: req.headers['x-session-id'], timestamp: new Date().toISOString() });
    return res.status(400).json({ errors: errors.array() });
  }
  const { user_id, link, is_enabled } = req.body;
  const image = req.file;
  const { id } = req.params;
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();
  logger.info('Parsed banner update request', {
    params: { id },
    body: req.body,
    file: image ? { name: image.filename, path: image.path } : null,
    userId: user?.id,
    sessionId,
    timestamp,
  });
  try {
    if (!user || user.id !== parseInt(user_id) || !await checkAdmin(user)) {
      logger.warn('Unauthorized attempt to update banner', { user_id, userId: user?.id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const bannerId = parseInt(id);
    const parsedIsEnabled = is_enabled === 'true' || is_enabled === true;
    const updateFields = [link.trim(), parsedIsEnabled, user_id];
    let query = 'UPDATE banners SET link = ?, is_enabled = ?, admin_id = ?';
    if (image) {
      const image_url = `/Uploads/${image.filename}`;
      query += ', image_url = ?';
      updateFields.push(image_url);
    }
    updateFields.push(bannerId);
    const [result] = await db.query(query + ' WHERE id = ?', updateFields);
    if (result.affectedRows === 0) {
      logger.warn('Banner not found for update', { id: bannerId, sessionId, timestamp });
      return res.status(404).json({ error: 'Banner not found' });
    }
    const [updatedBanner] = await db.query(
      'SELECT id, image_url, link, is_enabled, created_at, updated_at, admin_id FROM banners WHERE id = ?',
      [bannerId]
    );
    io.to(`user-${user.id}`).emit('banner-updated', updatedBanner[0]);
    if (parsedIsEnabled) {
      io.emit('banner-updated', updatedBanner[0]);
    } else {
      io.emit('banner-deleted', { id: bannerId }); // Notify clients to remove disabled banner
    }
    logger.info('Banner updated', { id: bannerId, link, is_enabled: parsedIsEnabled, userId: user.id, sessionId, timestamp });
    res.json({ message: 'Banner updated' });
  } catch (error) {
    logger.error('Error updating banner', { error: error.message, body: req.body, userId: user?.id, sessionId, timestamp });
    res.status(500).json({ error: 'Failed to update banner' });
  }
});

// Delete banner
router.delete('/banners/:id', [
  param('id').isInt({ min: 1 }).withMessage('Valid banner ID is required'),
  body('user_id').isInt({ min: 1 }).withMessage('Valid user ID is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors for banner deletion', { errors: errors.array(), sessionId: req.headers['x-session-id'], timestamp: new Date().toISOString() });
    return res.status(400).json({ errors: errors.array() });
  }
  const { user_id } = req.body;
  const { id } = req.params;
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();
  logger.info('Parsed banner deletion request', {
    params: { id },
    body: req.body,
    userId: user?.id,
    sessionId,
    timestamp,
  });
  try {
    if (!user || user.id !== parseInt(user_id) || !await checkAdmin(user)) {
      logger.warn('Unauthorized attempt to delete banner', { user_id, userId: user?.id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const bannerId = parseInt(id);
    const [result] = await db.query('DELETE FROM banners WHERE id = ?', [bannerId]);
    if (result.affectedRows === 0) {
      logger.warn('Banner not found for deletion', { id: bannerId, sessionId, timestamp });
      return res.status(404).json({ error: 'Banner not found' });
    }
    io.to(`user-${user.id}`).emit('banner-deleted', { id: bannerId });
    io.emit('banner-deleted', { id: bannerId });
    logger.info('Banner deleted', { id: bannerId, userId: user.id, sessionId, timestamp });
    res.json({ message: 'Banner deleted' });
  } catch (error) {
    logger.error('Error deleting banner', { error: error.message, id, userId: user?.id, sessionId, timestamp });
    res.status(500).json({ error: 'Failed to delete banner' });
  }
});

// Fetch all banners (admin only)
router.get('/banners', [
  body('user_id').isInt({ min: 1 }).withMessage('Valid user ID is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Validation errors for fetching banners', { errors: errors.array(), sessionId: req.headers['x-session-id'], timestamp: new Date().toISOString() });
    return res.status(400).json({ errors: errors.array() });
  }
  const { user_id } = req.body;
  const user = req.user;
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();
  logger.info('Parsed banners fetch request', {
    body: req.body,
    userId: user?.id,
    sessionId,
    timestamp,
  });
  try {
    if (!user || user.id !== parseInt(user_id) || !await checkAdmin(user)) {
      logger.warn('Unauthorized attempt to fetch banners', { user_id, userId: user?.id, sessionId, timestamp });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const [rows] = await db.query('SELECT id, image_url, link, is_enabled, created_at, updated_at, admin_id FROM banners');
    logger.info('Banners fetched', { count: rows.length, userId: user.id, sessionId, timestamp });
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching banners', { error: error.message, userId: user?.id, sessionId, timestamp });
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
});

// Fetch enabled banners (public)
router.get('/banners/enabled', async (req, res) => {
  const sessionId = req.headers['x-session-id'] || uuidv4();
  const timestamp = new Date().toISOString();
  try {
    const [rows] = await db.query('SELECT id, image_url, link FROM banners WHERE is_enabled = 1');
    logger.info('Enabled banners fetched', { count: rows.length, sessionId, timestamp });
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching enabled banners', { error: error.message, sessionId, timestamp });
    res.status(500).json({ error: 'Failed to fetch enabled banners' });
  }
});

module.exports = (io) => router;