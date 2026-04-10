const config = require('../config');

/**
 * Middleware для проверки API ключа
 * Поддерживает несколько способов передачи ключа:
 * 1. В заголовке X-API-Key
 * 2. В заголовке Authorization: Bearer <key>
 * 3. В query параметре api_key
 */
function apiKeyAuth(req, res, next) {
  // Если авторизация отключена, пропускаем проверку
  if (!config.auth.enabled) {
    return next();
  }

  // Извлекаем API ключ из разных источников
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API ключ не предоставлен',
      details: 'Передайте ключ в заголовке X-API-Key, Authorization: Bearer <key> или параметре api_key'
    });
  }

  if (apiKey !== config.auth.apiKey) {
    return res.status(401).json({
      success: false,
      message: 'Неверный API ключ'
    });
  }

  // Добавляем информацию об авторизации в запрос
  req.auth = {
    authenticated: true,
    method: 'api_key'
  };

  next();
}

/**
 * Извлекает API ключ из запроса
 */
function extractApiKey(req) {
  // 1. Проверяем заголовок X-API-Key
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }

  // 2. Проверяем заголовок Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 3. Проверяем query параметр
  if (req.query.api_key) {
    return req.query.api_key;
  }

  return null;
}

/**
 * Middleware для логирования попыток авторизации
 */
function logAuth(req, res, next) {
  if (config.auth.enabled) {
    const apiKey = extractApiKey(req);
    const hasKey = !!apiKey;
    const isValid = apiKey === config.auth.apiKey;
    
    console.log(`🔐 Авторизация: ${req.method} ${req.path} - Ключ: ${hasKey ? (isValid ? '✅ валидный' : '❌ неверный') : '❌ отсутствует'}`);
  }
  
  next();
}

module.exports = {
  apiKeyAuth,
  logAuth,
  extractApiKey
};
