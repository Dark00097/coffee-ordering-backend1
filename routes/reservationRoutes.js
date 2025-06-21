const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../logger');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const checkRole = async (user, allowedRoles = ['admin']) => {
  if (!user) return false;
  return allowedRoles.includes(user.role);
};

module.exports = (io) => {
  router.post('/tables', async (req, res) => {
    const { user_id, table_number, capacity } = req.body;
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || user.id !== parseInt(user_id) || !await checkRole(user, ['admin'])) {
        logger.warn('Unauthorized attempt to add table', { user_id, userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin access required' });
      }
      if (!table_number || !capacity) {
        logger.warn('Missing required fields', { fields: { table_number, capacity }, sessionId, timestamp });
        return res.status(400).json({ error: 'Table number and capacity are required' });
      }
      const parsedCapacity = parseInt(capacity);
      if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
        logger.warn('Invalid capacity', { capacity, sessionId, timestamp });
        return res.status(400).json({ error: 'Capacity must be a positive number' });
      }
      const [existing] = await db.query('SELECT id FROM tables WHERE table_number = ?', [table_number]);
      if (existing.length > 0) {
        logger.warn('Table number already exists', { table_number, sessionId, timestamp });
        return res.status(400).json({ error: 'Table number already exists' });
      }
      const [result] = await db.query(
        'INSERT INTO tables (table_number, capacity, status) VALUES (?, ?, ?)',
        [table_number, parsedCapacity, 'available']
      );
      logger.info('Table created', { id: result.insertId, table_number, userId: user.id, sessionId, timestamp });
      res.status(201).json({ message: 'Table created', id: result.insertId });
    } catch (error) {
      logger.error('Error creating table', { error: error.message, table_number, capacity, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to create table' });
    }
  });

  router.put('/tables/:id', async (req, res) => {
    const { user_id, table_number, capacity, status, reserved_until } = req.body;
    const { id } = req.params;
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || user.id !== parseInt(user_id) || !await checkRole(user, ['admin'])) {
        logger.warn('Unauthorized attempt to update table', { user_id, id, userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin access required' });
      }
      if (!table_number || !capacity) {
        logger.warn('Missing required fields', { fields: { table_number, capacity }, sessionId, timestamp });
        return res.status(400).json({ error: 'Table number and capacity are required' });
      }
      const parsedCapacity = parseInt(capacity);
      if (isNaN(parsedCapacity) || parsedCapacity <= 0) {
        logger.warn('Invalid capacity', { capacity, sessionId, timestamp });
        return res.status(400).json({ error: 'Capacity must be a positive number' });
      }
      const tableId = parseInt(id);
      if (isNaN(tableId) || tableId <= 0) {
        logger.warn('Invalid table ID', { id, sessionId, timestamp });
        return res.status(400).json({ error: 'Valid table ID is required' });
      }
      const [existing] = await db.query('SELECT id FROM tables WHERE table_number = ? AND id != ?', [table_number, tableId]);
      if (existing.length > 0) {
        logger.warn('Table number already exists', { table_number, sessionId, timestamp });
        return res.status(400).json({ error: 'Table number already exists' });
      }
      const updates = ['table_number = ?', 'capacity = ?'];
      const values = [table_number, parsedCapacity];
      if (status && ['available', 'occupied', 'reserved'].includes(status)) {
        updates.push('status = ?');
        values.push(status);
      }
      if (reserved_until) {
        updates.push('reserved_until = ?');
        values.push(reserved_until);
      }
      values.push(tableId);
      const [result] = await db.query(
        `UPDATE tables SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
      if (result.affectedRows === 0) {
        logger.warn('Table not found', { id: tableId, sessionId, timestamp });
        return res.status(404).json({ error: 'Table not found' });
      }
      if (status) {
        io.emit('tableStatusUpdate', { table_id: tableId, status });
      }
      logger.info('Table updated', { id: tableId, table_number, userId: user.id, sessionId, timestamp });
      res.json({ message: 'Table updated' });
    } catch (error) {
      logger.error('Error updating table', { error: error.message, table_number, capacity, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to update table' });
    }
  });

  router.delete('/tables/:id', async (req, res) => {
    const { user_id } = req.body;
    const { id } = req.params;
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || user.id !== parseInt(user_id) || !await checkRole(user, ['admin'])) {
        logger.warn('Unauthorized attempt to delete table', { user_id, userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin access required' });
      }
      const tableId = parseInt(id);
      if (isNaN(tableId) || tableId <= 0) {
        logger.warn('Invalid table ID', { id, sessionId, timestamp });
        return res.status(400).json({ error: 'Valid table ID is required' });
      }
      const [result] = await db.query('DELETE FROM tables WHERE id = ?', [tableId]);
      if (result.affectedRows === 0) {
        logger.warn('Table not found', { id: tableId, sessionId, timestamp });
        return res.status(404).json({ error: 'Table not found' });
      }
      logger.info('Table deleted', { id: tableId, userId: user.id, sessionId, timestamp });
      res.json({ message: 'Table deleted' });
    } catch (error) {
      logger.error('Error deleting table', { error: error.message, id, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to delete table' });
    }
  });

  router.get('/tables/:id', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || !await checkRole(user, ['admin'])) {
        logger.warn('Unauthorized attempt to fetch table', { userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin access required' });
      }
      const tableId = parseInt(id);
      if (isNaN(tableId) || tableId <= 0) {
        logger.warn('Invalid table ID', { id, sessionId, timestamp });
        return res.status(400).json({ error: 'Valid table ID is required' });
      }
      const [rows] = await db.query('SELECT id, table_number, capacity, status, reserved_until FROM tables WHERE id = ?', [tableId]);
      if (rows.length === 0) {
        logger.warn('Table not found', { id: tableId, sessionId, timestamp });
        return res.status(404).json({ error: 'Table not found' });
      }
      logger.info('Table fetched', { id: tableId, userId: user?.id, sessionId, timestamp });
      res.json(rows[0]);
    } catch (error) {
      logger.error('Error fetching table', { error: error.message, id, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to fetch table' });
    }
  });

  router.get('/tables', async (req, res) => {
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      const { status } = req.query;
      let query = 'SELECT id, table_number, capacity, status, reserved_until FROM tables';
      const params = [];
      if (status) {
        query += ' WHERE status = ? AND (reserved_until IS NULL OR reserved_until < NOW())';
        params.push(status);
      }
      const [rows] = await db.query(query, params);
      logger.info('Tables fetched', { count: rows.length, status, sessionId, timestamp });
      res.json(rows);
    } catch (error) {
      logger.error('Error fetching tables', { error: error.message, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to fetch tables' });
    }
  });

  router.post('/reservations', [
    body('table_id').isInt({ min: 1 }).withMessage('Valid table ID is required'),
    body('reservation_time').isString().withMessage('Valid reservation time is required'),
    body('phone_number').matches(/^\+\d{10,15}$/).withMessage('Phone number must be in international format (e.g., +1234567890)'),
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors for reservation', { errors: errors.array(), sessionId: req.headers['x-session-id'], timestamp: new Date().toISOString() });
      return res.status(400).json({ errors: errors.array() });
    }
    const { table_id, reservation_time, phone_number } = req.body;
    const user = req.user;
    const sessionId = req.headers['x-session-id'] || uuidv4();
    const timestamp = new Date().toISOString();

    try {
      const [table] = await db.query('SELECT status, reserved_until FROM tables WHERE id = ?', [table_id]);
      if (table.length === 0) {
        logger.warn('Table not found', { table_id, sessionId, timestamp });
        return res.status(404).json({ error: 'Table not found' });
      }
      const reservationDate = new Date(reservation_time);
      if (reservationDate <= new Date()) {
        logger.warn('Invalid reservation time', { reservation_time, sessionId, timestamp });
        return res.status(400).json({ error: 'Reservation time must be in the future' });
      }
      const reservationEnd = new Date(reservationDate.getTime() + 2 * 60 * 60 * 1000); // 2 hours
      const [existingReservations] = await db.query(
        'SELECT id FROM reservations WHERE table_id = ? AND reservation_time BETWEEN ? AND ?',
        [table_id, reservationDate, reservationEnd]
      );
      if (existingReservations.length > 0) {
        logger.warn('Table already reserved', { table_id, reservation_time, sessionId, timestamp });
        return res.status(400).json({ error: 'Table is already reserved for the selected time' });
      }
      const [result] = await db.query(
        'INSERT INTO reservations (table_id, reservation_time, phone_number, status, user_id, session_id) VALUES (?, ?, ?, ?, ?, ?)',
        [table_id, reservation_time, phone_number, 'pending', user?.id || null, user ? null : sessionId]
      );
      await db.query(
        'UPDATE tables SET status = ?, reserved_until = ? WHERE id = ?',
        ['reserved', reservationEnd, table_id]
      );
      const [newReservation] = await db.query(
        'SELECT r.*, t.table_number FROM reservations r JOIN tables t ON r.table_id = t.id WHERE r.id = ?',
        [result.insertId]
      );

      // Insert notification for all staff
      const [staffUsers] = await db.query('SELECT id FROM users WHERE role IN (?, ?)', ['admin', 'server']);
      for (const staff of staffUsers) {
        const [notificationResult] = await db.query(
          'INSERT INTO notifications (type, reference_id, message, staff_id) VALUES (?, ?, ?, ?)',
          ['reservation', result.insertId, `New reservation #${result.insertId} for table ${newReservation[0].table_number}`, staff.id]
        );
        const [notification] = await db.query('SELECT * FROM notifications WHERE id = ?', [notificationResult.insertId]);
        io.to(`user-${staff.id}`).emit('notification', {
          id: notification[0].id,
          type: notification[0].type,
          reference_id: notification[0].reference_id,
          message: notification[0].message,
          is_read: Number(notification[0].is_read),
          created_at: notification[0].created_at.toISOString(),
        });
      }

      io.to('staff-notifications').emit('notification', {
        type: 'reservation',
        reference_id: result.insertId,
        message: `New reservation #${result.insertId} for table ${newReservation[0].table_number}`,
        created_at: new Date().toISOString(),
      });

      io.emit('reservation-created', newReservation[0]);
      io.to(user ? `user-${user.id}` : `guest-${sessionId}`).emit('reservation-created', newReservation[0]);
      io.emit('tableStatusUpdate', { table_id, status: 'reserved' });

      logger.info('Reservation created', { id: result.insertId, table_id, reservation_time, userId: user?.id, sessionId, timestamp });
      res.status(201).json({ message: 'Reservation created', id: result.insertId });
    } catch (error) {
      logger.error('Error creating reservation', { error: error.message, table_id, reservation_time, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to create reservation' });
    }
  });

  router.get('/reservations', async (req, res) => {
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || !await checkRole(user, ['admin', 'server'])) {
        logger.warn('Unauthorized attempt to fetch reservations', { userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin or staff access required' });
      }
      const [rows] = await db.query(`
        SELECT r.*, t.table_number 
        FROM reservations r 
        JOIN tables t ON r.table_id = t.id
      `);
      logger.info('Reservations fetched', { count: rows.length, userId: user.id, sessionId, timestamp });
      res.json(rows);
    } catch (error) {
      logger.error('Error fetching reservations', { error: error.message, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to fetch reservations' });
    }
  });

  router.get('/reservations/:id', async (req, res) => {
    const { id } = req.params;
    const user = req.user;
    const sessionId = req.headers['x-session-id'] || uuidv4();
    const timestamp = new Date().toISOString();

    try {
      const reservationId = parseInt(id);
      if (isNaN(reservationId) || reservationId <= 0) {
        logger.warn('Invalid reservation ID', { id, sessionId, timestamp });
        return res.status(400).json({ error: 'Valid reservation ID is required' });
      }
      const [rows] = await db.query(`
        SELECT r.*, t.table_number 
        FROM reservations r 
        JOIN tables t ON r.table_id = t.id 
        WHERE r.id = ?
      `, [reservationId]);
      if (rows.length === 0) {
        logger.warn('Reservation not found', { id: reservationId, sessionId, timestamp });
        return res.status(404).json({ error: 'Reservation not found' });
      }
      const reservation = rows[0];
      if (!user && reservation.session_id !== sessionId) {
        logger.warn('Unauthorized access to reservation', { reservationId, sessionId, timestamp });
        return res.status(403).json({ error: 'Access denied' });
      }
      if (user && !await checkRole(user, ['admin', 'server']) && reservation.user_id !== user.id) {
        logger.warn('Unauthorized access to reservation', { reservationId, userId: user.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Access denied' });
      }
      logger.info('Reservation fetched', { id: reservationId, userId: user?.id, sessionId, timestamp });
      res.json(reservation);
    } catch (error) {
      logger.error('Error fetching reservation', { error: error.message, id, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to fetch reservation' });
    }
  });

  router.put('/reservations/:id', [
    body('table_id').optional().isInt({ min: 1 }).withMessage('Valid table ID is required'),
    body('reservation_time').optional().isString().withMessage('Valid reservation time is required'),
    body('phone_number').optional().matches(/^\+\d{10,15}$/).withMessage('Phone number must be in international format'),
    body('status').optional().isIn(['pending', 'confirmed', 'cancelled']).withMessage('Invalid status'),
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors for updating reservation', { errors: errors.array(), sessionId: req.headers['x-session-id'], timestamp: new Date().toISOString() });
      return res.status(400).json({ errors: errors.array() });
    }
    const { user_id, table_id, reservation_time, phone_number, status } = req.body;
    const { id } = req.params;
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || user.id !== parseInt(user_id) || !await checkRole(user, ['admin', 'server'])) {
        logger.warn('Unauthorized attempt to update reservation', { user_id, userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin or staff access required' });
      }
      const reservationId = parseInt(id);
      if (isNaN(reservationId) || reservationId <= 0) {
        logger.warn('Invalid reservation ID', { id, sessionId, timestamp });
        return res.status(400).json({ error: 'Valid reservation ID is required' });
      }
      const [existing] = await db.query('SELECT id, table_id FROM reservations WHERE id = ?', [reservationId]);
      if (existing.length === 0) {
        logger.warn('Reservation not found', { id: reservationId, sessionId, timestamp });
        return res.status(404).json({ error: 'Reservation not found' });
      }
      const updates = [];
      const values = [];
      if (table_id) {
        const [table] = await db.query('SELECT id FROM tables WHERE id = ?', [table_id]);
        if (table.length === 0) {
          logger.warn('Table not found', { table_id, sessionId, timestamp });
          return res.status(404).json({ error: 'Table not found' });
        }
        updates.push('table_id = ?');
        values.push(table_id);
      }
      if (reservation_time) {
        const reservationDate = new Date(reservation_time);
        if (reservationDate <= new Date()) {
          logger.warn('Invalid reservation time', { reservation_time, sessionId, timestamp });
          return res.status(400).json({ error: 'Reservation time must be in the future' });
        }
        updates.push('reservation_time = ?');
        values.push(reservation_time);
      }
      if (phone_number) {
        updates.push('phone_number = ?');
        values.push(phone_number);
      }
      if (status) {
        updates.push('status = ?');
        values.push(status);
      }
      if (updates.length === 0) {
        logger.warn('No fields to update', { id: reservationId, sessionId, timestamp });
        return res.status(400).json({ error: 'No fields to update' });
      }
      values.push(reservationId);
      const [result] = await db.query(`UPDATE reservations SET ${updates.join(', ')} WHERE id = ?`, values);
      if (result.affectedRows === 0) {
        logger.warn('No rows updated', { id: reservationId, sessionId, timestamp });
        return res.status(404).json({ error: 'Reservation not found' });
      }
      if (table_id && reservation_time) {
        const reservationEnd = new Date(new Date(reservation_time).getTime() + 2 * 60 * 60 * 1000);
        await db.query(
          'UPDATE tables SET status = ?, reserved_until = ? WHERE id = ?',
          ['reserved', reservationEnd, table_id]
        );
        io.emit('tableStatusUpdate', { table_id, status: 'reserved' });
      } else if (status === 'cancelled') {
        await db.query(
          'UPDATE tables SET status = ?, reserved_until = NULL WHERE id = ?',
          ['available', existing[0].table_id]
        );
        io.emit('tableStatusUpdate', { table_id: existing[0].table_id, status: 'available' });
      }
      const [updatedReservation] = await db.query(
        'SELECT r.*, t.table_number FROM reservations r JOIN tables t ON r.table_id = t.id WHERE r.id = ?',
        [reservationId]
      );
      io.emit('reservation-updated', updatedReservation[0]);
      io.to(updatedReservation[0].user_id ? `user-${updatedReservation[0].user_id}` : `guest-${updatedReservation[0].session_id}`).emit('reservation-updated', updatedReservation[0]);
      logger.info('Reservation updated', { id: reservationId, userId: user.id, sessionId, timestamp });
      res.json({ message: 'Reservation updated' });
    } catch (error) {
      logger.error('Error updating reservation', { error: error.message, id, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to update reservation' });
    }
  });

  router.delete('/reservations/:id', async (req, res) => {
    const { user_id } = req.body;
    const { id } = req.params;
    const user = req.user;
    const timestamp = new Date().toISOString();
    const sessionId = req.headers['x-session-id'] || uuidv4();

    try {
      if (!user || user.id !== parseInt(user_id) || !await checkRole(user, ['admin', 'server'])) {
        logger.warn('Unauthorized attempt to delete reservation', { user_id, userId: user?.id, sessionId, timestamp });
        return res.status(403).json({ error: 'Admin or staff access required' });
      }
      const reservationId = parseInt(id);
      if (isNaN(reservationId) || reservationId <= 0) {
        logger.warn('Invalid reservation ID', { id, sessionId, timestamp });
        return res.status(400).json({ error: 'Valid reservation ID is required' });
      }
      const [reservation] = await db.query('SELECT table_id, user_id, session_id FROM reservations WHERE id = ?', [reservationId]);
      if (reservation.length === 0) {
        logger.warn('Reservation not found', { id: reservationId, sessionId, timestamp });
        return res.status(404).json({ error: 'Reservation not found' });
      }
      const [result] = await db.query('DELETE FROM reservations WHERE id = ?', [reservationId]);
      if (result.affectedRows === 0) {
        logger.warn('No rows deleted', { id: reservationId, sessionId, timestamp });
        return res.status(404).json({ error: 'Reservation not found' });
      }
      await db.query(
        'UPDATE tables SET status = ?, reserved_until = NULL WHERE id = ?',
        ['available', reservation[0].table_id]
      );
      io.emit('tableStatusUpdate', { table_id: reservation[0].table_id, status: 'available' });
      io.emit('reservation-deleted', { id: reservationId });
      io.to(reservation[0].user_id ? `user-${reservation[0].user_id}` : `guest-${reservation[0].session_id}`).emit('reservation-deleted', { id: reservationId });
      logger.info('Reservation deleted', { id: reservationId, userId: user.id, sessionId, timestamp });
      res.json({ message: 'Reservation deleted' });
    } catch (error) {
      logger.error('Error deleting reservation', { error: error.message, id, userId: user?.id, sessionId, timestamp });
      res.status(500).json({ error: 'Failed to delete reservation' });
    }
  });

  return router;
};