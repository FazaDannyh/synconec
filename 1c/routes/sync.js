const express = require('express');
const router = express.Router();
const SyncController = require('../controllers/syncController');
const { apiKeyAuth } = require('../middleware/authMiddleware');

// Создаем экземпляр контроллера
const syncController = new SyncController();

// POST /api/sync/1c - Основной эндпоинт для синхронизации с 1С (с авторизацией)
router.post('/1c', apiKeyAuth, (req, res) => syncController.syncWith1C(req, res));

// GET /api/sync/auth-check - Проверка авторизации
router.get('/auth-check', apiKeyAuth, (req, res) => {
  res.json({
    success: true,
    message: 'Авторизация прошла успешно',
    authenticated: true,
    method: req.auth?.method || 'unknown'
  });
});

module.exports = router;
