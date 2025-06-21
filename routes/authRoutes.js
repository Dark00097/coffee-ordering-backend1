const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../logger');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const checkAdmin = async (userId) => {
  if (!userId) return false;
  const [rows] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
  return rows.length > 0 && rows[0].role === 'admin';
};

router.get('/check-auth', async (req, res) => {
  try {
    if (!req.user) {
      logger.info('No authenticated user', { path: req.path, sessionId: req.sessionId });
      return res.status(401).json({ error: 'Not authenticated' });
    }
    logger.info('Authenticated user found', { user: req.user, sessionId: req.sessionId });
    res.json({ id: req.user.id, email: req.user.email, role: req.user.role });
  } catch (error) {
    logger.error('Error checking auth', { error: error.message, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to check auth' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  logger.debug('Login attempt', { email, sessionId: req.sessionId });
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      logger.warn('Invalid credentials: User not found', { email, sessionId: req.sessionId });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      logger.warn('Invalid credentials: Password mismatch', { email, sessionId: req.sessionId });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your_jwt_secret',
      { expiresIn: '24h' }
    );
    logger.info('User logged in successfully', { userId: user.id, email: user.email, role: user.role, sessionId: req.sessionId });
    res.json({ message: 'Logged in', user: { id: user.id, email: user.email, role: user.role }, token });
  } catch (error) {
    logger.error('Error during login', { error: error.message, email, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to login' });
  }
});

router.post('/logout', (req, res) => {
  logger.info('User logged out', { sessionId: req.sessionId });
  res.json({ message: 'Logged out' });
});

router.post('/staff', async (req, res) => {
  const { user_id, email, password, role } = req.body;
  try {
    if (!req.user || req.user.id !== parseInt(user_id) || !await checkAdmin(user_id)) {
      logger.warn('Unauthorized attempt to add staff', { user_id, sessionUser: req.user, sessionId: req.sessionId });
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (role !== 'server') {
      logger.warn('Invalid role', { role, sessionId: req.sessionId });
      return res.status(400).json({ error: 'Invalid role' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await db.query('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', [email, password_hash, role]);
    logger.info('Server added', { id: result.insertId, email, sessionId: req.sessionId });
    res.status(201).json({ message: 'Server added', id: result.insertId });
  } catch (error) {
    logger.error('Error adding staff', { error: error.message, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to add staff' });
  }
});

router.put('/users/:id', async (req, res) => {
  const { user_id, email, password, role } = req.body;
  const { id } = req.params;
  try {
    if (!req.user || req.user.id !== parseInt(user_id) || !await checkAdmin(user_id)) {
      logger.warn('Unauthorized attempt to update user', { user_id, sessionUser: req.user, sessionId: req.sessionId });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const userId = parseInt(id);
    if (isNaN(userId) || userId <= 0) {
      logger.warn('Invalid user ID', { id, sessionId: req.sessionId });
      return res.status(400).json({ error: 'Valid user ID is required' });
    }
    if (role !== 'server' && role !== 'admin') {
      logger.warn('Invalid role', { role, sessionId: req.sessionId });
      return res.status(400).json({ error: 'Invalid role' });
    }
    const [existing] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (existing.length === 0) {
      logger.warn('User not found', { id: userId, sessionId: req.sessionId });
      return res.status(404).json({ error: 'User not found' });
    }
    const updates = [];
    const values = [];
    if (email) {
      updates.push('email = ?');
      values.push(email);
    }
    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      values.push(password_hash);
    }
    if (role) {
      updates.push('role = ?');
      values.push(role);
    }
    if (updates.length === 0) {
      logger.warn('No fields to update', { id: userId, sessionId: req.sessionId });
      return res.status(400).json({ error: 'No fields to update' });
    }
    values.push(userId);
    const [result] = await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    if (result.affectedRows === 0) {
      logger.warn('No rows updated', { id: userId, sessionId: req.sessionId });
      return res.status(404).json({ error: 'User not found' });
    }
    logger.info('User updated', { id: userId, email, sessionId: req.sessionId });
    res.json({ message: 'User updated' });
  } catch (error) {
    logger.error('Error updating user', { error: error.message, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  const { user_id } = req.body;
  const { id } = req.params;
  try {
    if (!req.user || req.user.id !== parseInt(user_id) || !await checkAdmin(user_id)) {
      logger.warn('Unauthorized attempt to delete user', { user_id, sessionUser: req.user, sessionId: req.sessionId });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const userId = parseInt(id);
    if (isNaN(userId) || userId <= 0) {
      logger.warn('Invalid user ID', { id, sessionId: req.sessionId });
      return res.status(400).json({ error: 'Valid user ID is required' });
    }
    const [existing] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (existing.length === 0) {
      logger.warn('User not found', { id: userId, sessionId: req.sessionId });
      return res.status(404).json({ error: 'User not found' });
    }
    const [result] = await db.query('DELETE FROM users WHERE id = ?', [userId]);
    if (result.affectedRows === 0) {
      logger.warn('No rows deleted', { id: userId, sessionId: req.sessionId });
      return res.status(404).json({ error: 'User not found' });
    }
    logger.info('User deleted', { id: userId, sessionId: req.sessionId });
    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('Error deleting user', { error: error.message, id, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.get('/users', async (req, res) => {
  try {
    if (!req.user || !await checkAdmin(req.user.id)) {
      logger.warn('Unauthorized attempt to fetch users', { sessionUser: req.user, sessionId: req.sessionId });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const [rows] = await db.query('SELECT id, email, role, created_at FROM users');
    logger.info('Users fetched successfully', { count: rows.length, sessionId: req.sessionId });
    res.json(rows);
  } catch (error) {
    logger.error('Error fetching users', { error: error.message, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.get('/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (!req.user || !await checkAdmin(req.user.id)) {
      logger.warn('Unauthorized attempt to fetch user', { sessionUser: req.user, sessionId: req.sessionId });
      return res.status(403).json({ error: 'Admin access required' });
    }
    const userId = parseInt(id);
    if (isNaN(userId) || userId <= 0) {
      logger.warn('Invalid user ID', { id, sessionId: req.sessionId });
      return res.status(400).json({ error: 'Valid user ID is required' });
    }
    const [rows] = await db.query('SELECT id, email, role, created_at FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      logger.warn('User not found', { id: userId, sessionId: req.sessionId });
      return res.status(404).json({ error: 'User not found' });
    }
    logger.info('User fetched', { id: userId, sessionId: req.sessionId });
    res.json(rows[0]);
  } catch (error) {
    logger.error('Error fetching user', { error: error.message, id, sessionId: req.sessionId });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;