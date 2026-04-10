// Настройка тестового окружения ПЕРЕД импортом модулей
process.env.BITRIX24_WEBHOOK_URL = 'https://test.bitrix24.ru/rest/1/webhook123/';
process.env.BITRIX24_USER_ID = '1';
process.env.NODE_ENV = 'test';

const Bitrix24Mock = require('./bitrix24Mock');
const SyncController = require('../controllers/syncController');

class MockTestRunner {
  constructor() {
    this.mock = new Bitrix24Mock();
    this.testResults = [];
  }

  log(message, color = '') {
    const colors = {
      green: '\x1b[32m',
      red: '\x1b[31m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      reset: '\x1b[0m'
    };
    console.log(`${colors[color] || ''}${message}${colors.reset}`);
  }

  // Мок Express request/response объектов
  createMockReqRes(body) {
    const req = { body };
    const res = {
      status: function(code) { this.statusCode = code; return this; },
      json: function(data) { this.data = data; return this; },
      statusCode: 200,
      data: null
    };
    return { req, res };
  }

  // Тест создания новой сделки
  async testNewDealCreation() {
    this.log('\n📋 Тест: Создание новой сделки', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: 'mock-test-001',
          Number_Order: 'MOCK001',
          Date_Order: '2025-08-06T10:00:00Z',
          CompanyINN: '1234567890',
          Responsible: 'Гладков А.',
          products: [
            { name: 'Тестовый товар', quantity: 5, price: 1000 }
          ]
        }
      ]
    };

    const { req, res } = this.createMockReqRes(testData);
    
    try {
      // Создаем новый экземпляр контроллера для каждого теста
      const controller = new SyncController();
      await controller.syncWith1C(req, res);
      
      if (res.data && res.data.success && res.data.results[0].action === 'created') {
        this.log('✅ Новая сделка успешно создана', 'green');
        this.log(`   Действие: ${res.data.results[0].action}`);
        this.log(`   Deal ID: ${res.data.results[0].dealId}`);
      } else {
        this.log('❌ Ошибка создания сделки', 'red');
        console.log('Ответ:', res.data);
      }
    } catch (error) {
      this.log(`❌ Исключение: ${error.message}`, 'red');
    }
  }

  // Тест обновления существующей сделки
  async testExistingDealUpdate() {
    this.log('\n🔄 Тест: Обновление существующей сделки', 'cyan');
    
    // Настраиваем мок для существующей сделки
    this.mock.setupExistingDealMock();
    
    const testData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: 'existing-guid-001',
          Number_Order: 'EXIST001',
          Date_Order: '2025-08-06T11:00:00Z',
          CompanyINN: '9876543210',
          Responsible: 'Администратор И.',
          products: [
            { name: 'Обновленный товар', quantity: 15, price: 1500 }
          ]
        }
      ]
    };

    const { req, res } = this.createMockReqRes(testData);
    
    try {
      const controller = new SyncController();
      await controller.syncWith1C(req, res);
      
      if (res.data && res.data.success && res.data.results[0].action === 'updated') {
        this.log('✅ Существующая сделка обновлена', 'green');
        this.log(`   Действие: ${res.data.results[0].action}`);
        this.log(`   Deal ID: ${res.data.results[0].dealId}`);
      } else {
        this.log('❌ Ошибка обновления сделки', 'red');
        console.log('Ответ:', res.data);
      }
    } catch (error) {
      this.log(`❌ Исключение: ${error.message}`, 'red');
    }
  }

  // Тест отгрузки
  async testShipment() {
    this.log('\n📦 Тест: Обработка отгрузки', 'cyan');
    
    // Сбрасываем моки
    this.mock.reset();
    
    const testData = {
      Documents: [
        {
          type: 'Отгрузка',
          GUID_Order: 'test-guid-001',
          shipped: [
            { name: 'Отгруженный товар', quantity: 3, price: 1000 }
          ]
        }
      ]
    };

    const { req, res } = this.createMockReqRes(testData);
    
    try {
      const controller = new SyncController();
      await controller.syncWith1C(req, res);
      
      if (res.data && res.data.success && res.data.results[0].action === 'shipped') {
        this.log('✅ Отгрузка обработана', 'green');
        this.log(`   Действие: ${res.data.results[0].action}`);
        this.log(`   Deal ID: ${res.data.results[0].dealId}`);
      } else {
        this.log('❌ Ошибка обработки отгрузки', 'red');
        console.log('Ответ:', res.data);
      }
    } catch (error) {
      this.log(`❌ Исключение: ${error.message}`, 'red');
    }
  }

  // Тест досрочного закрытия
  async testEarlyClosing() {
    this.log('\n🔒 Тест: Досрочное закрытие сделок', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'ЗакрытиеСделкиДосрочно',
          GUID_Document: 'close-mock-001',
          NumberDocument: 'CLOSEM001',
          DateDocument: '2025-08-06T15:00:00Z',
          Orders: [
            { GUID_Order: 'test-guid-001', Number_Order: 'ORDER001', Date_Order: '2025-08-06T10:00:00Z' },
            { GUID_Order: 'test-guid-002', Number_Order: 'ORDER002', Date_Order: '2025-08-06T11:00:00Z' }
          ]
        }
      ]
    };

    const { req, res } = this.createMockReqRes(testData);
    
    try {
      const controller = new SyncController();
      await controller.syncWith1C(req, res);
      
      if (res.data && res.data.success && res.data.results[0].action === 'early_closing') {
        this.log('✅ Досрочное закрытие выполнено', 'green');
        this.log(`   Обработано: ${res.data.results[0].processed.length} сделок`);
      } else {
        this.log('❌ Ошибка досрочного закрытия', 'red');
        console.log('Ответ:', res.data);
      }
    } catch (error) {
      this.log(`❌ Исключение: ${error.message}`, 'red');
    }
  }

  // Тест обработки ошибок
  async testErrorHandling() {
    this.log('\n⚠️ Тест: Обработка ошибок', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'НеизвестныйТип',
          GUID_Order: 'error-test-001'
        }
      ]
    };

    const { req, res } = this.createMockReqRes(testData);
    
    try {
      const controller = new SyncController();
      await controller.syncWith1C(req, res);
      
      if (res.data && res.data.success && res.data.results[0].success === false) {
        this.log('✅ Ошибка корректно обработана', 'green');
        this.log(`   Сообщение: ${res.data.results[0].message}`);
      } else {
        this.log('❌ Ошибка обработки неизвестного типа', 'red');
        console.log('Ответ:', res.data);
      }
    } catch (error) {
      this.log(`❌ Исключение: ${error.message}`, 'red');
    }
  }

  // Тест с реальными данными из example.json
  async testRealData() {
    this.log('\n📄 Тест: Данные из example.json', 'cyan');
    
    this.mock.reset();
    
    const realData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: '45d60347-4f0e-11f0-815c-80b3c846805d',
          Number_Order: 'УТБТГ003161',
          Date_Order: '2025-07-16T07:58:51Z',
          Company: '91287a20-53d4-11e6-be3e-5254008957e2',
          CompanyINN: '3808190277',
          Client: 'b78542c4-f277-11ef-815b-82ed8e1dbb29',
          ClientINN: '7500014036',
          Responsible: 'Гладков А.',
          products: [
            {
              name: 'Каска Delta Plus защитная строительная DIAMONDV, черного цвета DIAM5NO',
              quantity: 140,
              price: 2300
            },
            {
              name: 'Каска Delta Plus защитная BASEBALL DIAMOND V UP из ABS лимонного цвета DIAM5UPJAF',
              quantity: 20,
              price: 2300
            }
          ]
        }
      ]
    };

    const { req, res } = this.createMockReqRes(realData);
    
    try {
      const controller = new SyncController();
      await controller.syncWith1C(req, res);
      
      if (res.data && res.data.success) {
        this.log('✅ Реальные данные обработаны', 'green');
        this.log(`   Обработано документов: ${res.data.processed}`);
        this.log(`   Действие: ${res.data.results[0].action}`);
      } else {
        this.log('❌ Ошибка обработки реальных данных', 'red');
        console.log('Ответ:', res.data);
      }
    } catch (error) {
      this.log(`❌ Исключение: ${error.message}`, 'red');
    }
  }

  // Запуск всех тестов
  async runAllTests() {
    this.log('🧪 ЗАПУСК MOCK ТЕСТОВ (БЕЗ СЕРВЕРА)', 'yellow');
    this.log('='.repeat(50), 'yellow');
    
    await this.testNewDealCreation();
    await this.testExistingDealUpdate();
    await this.testShipment();
    await this.testEarlyClosing();
    await this.testErrorHandling();
    await this.testRealData();
    
    this.log('\n' + '='.repeat(50), 'yellow');
    this.log('🎉 ВСЕ MOCK ТЕСТЫ ЗАВЕРШЕНЫ!', 'green');
    this.log('\n💡 Для полных E2E тестов запустите: npm run test:e2e', 'cyan');
  }
}

// Запуск mock тестов
const mockRunner = new MockTestRunner();
mockRunner.runAllTests().catch(error => {
  console.error('💥 Ошибка mock тестов:', error);
  process.exit(1);
});
