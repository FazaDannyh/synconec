// Конфигурация приложения на основе переменных окружения
require('dotenv').config();

const parseIds = (s) => (s ? String(s).split(',').map(v => Number(v.trim())).filter(n => Number.isFinite(n)) : []);

const config = {
  // Основные настройки
  bitrix24: {
    webhookUrl: process.env.BITRIX24_WEBHOOK_URL,
  },

  // Настройки сервера
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },

  // Глобальные статусы (не используются, оставлены для обратной совместимости)
  dealStages: {
    invoice: process.env.DEAL_STAGE_INVOICE || null,
    shipment: process.env.DEAL_STAGE_SHIPMENT || null,
    closed: process.env.DEAL_STAGE_CLOSED || null,
  },

  // Воронки и маппинг департаментов
  pipelines: {
    category1Id: Number(process.env.DEAL_CATEGORY1_ID || 0) || null,
    category2Id: Number(process.env.DEAL_CATEGORY2_ID || 0) || null,
    category3Id: Number(process.env.DEAL_CATEGORY3_ID || 0) || null,
    deptCat1Ids: parseIds(process.env.DEPARTMENT_CAT1_IDS),
    deptCat2Ids: parseIds(process.env.DEPARTMENT_CAT2_IDS),
    deptCat3Ids: parseIds(process.env.DEPARTMENT_CAT3_IDS),
    stagesByCategory: {},
  },

  // Пользовательские поля сделок
  dealFields: {
    guid: process.env.DEAL_FIELD_GUID || 'UF_CRM_GUID_ORDER',
    originalProducts: process.env.DEAL_FIELD_ORIGINAL_PRODUCTS || 'UF_CRM_ORIGINAL_PRODUCTS',
    // Строковые множественные поля
    orderProductsStrings: process.env.DEAL_FIELD_ORDER_PRODUCTS_STRINGS || 'UF_CRM_ORDER_PRODUCTS_STR',
    shippedProductsStrings: process.env.DEAL_FIELD_SHIPPED_PRODUCTS_STRINGS || 'UF_CRM_SHIPPED_PRODUCTS_STR',
    // Суммы
    invoiceSum: process.env.DEAL_FIELD_INVOICE_SUM || 'UF_CRM_INVOICE_SUM',
    shippedSum: process.env.DEAL_FIELD_SHIPPED_SUM || 'UF_CRM_SHIPPED_SUM',
    // JSON поля (необязательные)
    invoiceProductsJson: process.env.DEAL_FIELD_INVOICE_PRODUCTS_JSON || 'UF_CRM_INVOICE_PRODUCTS_JSON',
    shippedProductsJson: process.env.DEAL_FIELD_SHIPPED_PRODUCTS_JSON || 'UF_CRM_SHIPPED_PRODUCTS_JSON',
  },

  // Пользовательские поля компаний
  companyFields: {
    inn: process.env.COMPANY_FIELD_INN || 'UF_CRM_INN',
  },

  // Авторизация API
  auth: {
    apiKey: process.env.API_KEY || 'your-secret-api-key-here',
    enabled: process.env.AUTH_ENABLED ? process.env.AUTH_ENABLED === 'true' : true,
  },

  // Логирование
  logging: {
    logApiCalls: process.env.LOG_API_CALLS === 'true' || false,
  }

};

// Инициализация стадий для категорий (без fallback на глобальные стадии)
if (config.pipelines.category1Id) {
  config.pipelines.stagesByCategory[config.pipelines.category1Id] = {
    invoice: process.env.DEAL_STAGE_INVOICE_CAT1 || null,
    shipment: process.env.DEAL_STAGE_SHIPMENT_CAT1 || null,
    closed: process.env.DEAL_STAGE_CLOSED_CAT1 || null,
  };
}
if (config.pipelines.category2Id) {
  config.pipelines.stagesByCategory[config.pipelines.category2Id] = {
    invoice: process.env.DEAL_STAGE_INVOICE_CAT2 || null,
    shipment: process.env.DEAL_STAGE_SHIPMENT_CAT2 || null,
    closed: process.env.DEAL_STAGE_CLOSED_CAT2 || null,
  };
}
if (config.pipelines.category3Id) {
  config.pipelines.stagesByCategory[config.pipelines.category3Id] = {
    invoice: process.env.DEAL_STAGE_INVOICE_CAT3 || null,
    shipment: process.env.DEAL_STAGE_SHIPMENT_CAT3 || null,
    closed: process.env.DEAL_STAGE_CLOSED_CAT3 || null,
  };
}

// Создаем массив всех закрытых стадий для исключения из поиска
config.allClosedStages = [];
Object.values(config.pipelines.stagesByCategory).forEach(stages => {
  if (stages.closed) {
    config.allClosedStages.push(stages.closed);
  }
});

// Добавляем дополнительные закрытые стадии
config.allClosedStages.push('C4:WON', 'C3:WON');

// Валидация обязательных настроек
function validateConfig() {
  const errors = [];

  if (!config.bitrix24.webhookUrl) {
    errors.push('BITRIX24_WEBHOOK_URL не настроен');
  }

  if (!config.bitrix24.webhookUrl?.endsWith('/')) {
    errors.push('BITRIX24_WEBHOOK_URL должен заканчиваться слешем');
  }

  if (config.auth.enabled && !config.auth.apiKey) {
    errors.push('API_KEY не настроен (требуется для авторизации)');
  }

  if (config.auth.enabled && config.auth.apiKey === 'your-secret-api-key-here') {
    errors.push('API_KEY использует значение по умолчанию. Установите собственный ключ!');
  }

  // Проверка, что для каждой активной категории заданы все 3 стадии
  const checkStages = (catId, idx) => {
    if (!catId) return;
    const stages = config.pipelines.stagesByCategory[catId];
    if (!stages || !stages.invoice || !stages.shipment || !stages.closed) {
      errors.push(`Для категории DEAL_CATEGORY${idx}_ID=${catId} не заданы все стадии (DEAL_STAGE_*_CAT${idx})`);
    }
  };
  checkStages(config.pipelines.category1Id, 1);
  checkStages(config.pipelines.category2Id, 2);
  checkStages(config.pipelines.category3Id, 3);

  if (errors.length > 0) {
    throw new Error(`Ошибки конфигурации:\n${errors.join('\n')}`);
  }
}

// Проверяем конфигурацию при загрузке модуля
validateConfig();

// Вспомогательные функции
config.isDevelopment = () => config.server.nodeEnv === 'development';
config.isProduction = () => config.server.nodeEnv === 'production';

// Хелперы для воронок и департаментов
config.getStagesForCategoryId = (categoryId) => {
  const id = Number(categoryId);
  const stages = config.pipelines.stagesByCategory[id];
  if (!stages) {
    throw new Error(`Стадии для категории ${id} не настроены`);
  }
  return stages;
};

config.resolveCategoryByDepartments = (deptIds = []) => {
  const depts = (Array.isArray(deptIds) ? deptIds : [deptIds]).map(Number).filter(Number.isFinite);
  if (depts.some(d => config.pipelines.deptCat1Ids.includes(d))) return config.pipelines.category1Id;
  if (depts.some(d => config.pipelines.deptCat2Ids.includes(d))) return config.pipelines.category2Id;
  if (depts.some(d => config.pipelines.deptCat3Ids.includes(d))) return config.pipelines.category3Id;
  // Если департамент не найден — бросаем ошибку, чтобы не использовать глобальные стадии
  throw new Error('Не удалось определить категорию по департаментам ответственного');
};

// Логирование текущей конфигурации (только в development)
if (config.isDevelopment()) {
  console.log('🔧 Конфигурация загружена:');
  console.log(`   Bitrix24 URL: ${config.bitrix24.webhookUrl}`);
  console.log(`   Порт сервера: ${config.server.port}`);
  console.log(`   Авторизация: ${config.auth.enabled ? 'включена' : 'отключена'}`);
  const cats = Object.keys(config.pipelines.stagesByCategory);
  console.log(`   Настроенные категории: ${cats.join(', ') || 'нет'}`);
  console.log(`   Dept→Cat mapping:`);
  console.log(`     CAT1=${config.pipelines.category1Id}, DEPTS: [${config.pipelines.deptCat1Ids.join(', ')}]`);
  console.log(`     CAT2=${config.pipelines.category2Id}, DEPTS: [${config.pipelines.deptCat2Ids.join(', ')}]`);
  console.log(`     CAT3=${config.pipelines.category3Id}, DEPTS: [${config.pipelines.deptCat3Ids.join(', ')}]`);
}

module.exports = config;
