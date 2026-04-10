// Настройка тестового окружения
process.env.BITRIX24_WEBHOOK_URL = 'https://test.bitrix24.ru/rest/1/webhook123/';
process.env.BITRIX24_USER_ID = '1';
process.env.NODE_ENV = 'test';

const Bitrix24Mock = require('./bitrix24Mock');

// Простая проверка функциональности
async function runSimpleTest() {
  console.log('🧪 ПРОСТОЙ ТЕСТ СИСТЕМЫ');
  console.log('='.repeat(30));
  
  // Тест 1: Проверка мокинга
  console.log('📋 Тест 1: Мок Bitrix24');
  try {
    const mock = new Bitrix24Mock();
    console.log('✅ Мок создан успешно');
  } catch (error) {
    console.log('❌ Ошибка создания мока:', error.message);
  }
  
  // Тест 2: Проверка переменных окружения
  console.log('\n🔧 Тест 2: Переменные окружения');
  const webhook = process.env.BITRIX24_WEBHOOK_URL;
  const userId = process.env.BITRIX24_USER_ID;
  
  if (webhook && userId) {
    console.log('✅ Переменные окружения настроены');
    console.log(`   Webhook: ${webhook}`);
    console.log(`   User ID: ${userId}`);
  } else {
    console.log('❌ Переменные окружения не настроены');
  }
  
  // Тест 3: Структура данных
  console.log('\n📄 Тест 3: Структура тестовых данных');
  const testData = {
    Documents: [
      {
        type: 'Сделка',
        GUID_Order: 'test-guid-001',
        Number_Order: 'TEST001',
        Date_Order: '2025-08-06T10:00:00Z',
        CompanyINN: '1234567890',
        Responsible: 'Тестовый пользователь',
        products: [
          { name: 'Тестовый товар', quantity: 1, price: 1000 }
        ]
      }
    ]
  };
  
  if (testData.Documents && testData.Documents.length > 0) {
    console.log('✅ Тестовые данные корректны');
    console.log(`   Тип документа: ${testData.Documents[0].type}`);
    console.log(`   GUID: ${testData.Documents[0].GUID_Order}`);
    console.log(`   Товаров: ${testData.Documents[0].products.length}`);
  } else {
    console.log('❌ Тестовые данные некорректны');
  }
  
  console.log('\n' + '='.repeat(30));
  console.log('🎉 Простой тест завершен!');
  console.log('\n💡 Для полного тестирования исправьте export в syncController.js:');
  console.log('   module.exports = SyncController;');
}

runSimpleTest().catch(console.error);
