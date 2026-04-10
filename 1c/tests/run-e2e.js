// Улучшенный E2E тестер с полным мокингом
const express = require('express');
const { spawn } = require('child_process');
const request = require('request');
const nock = require('nock');

// Настройка окружения
process.env.BITRIX24_WEBHOOK_URL = 'https://test.bitrix24.ru/rest/1/webhook123/';
process.env.BITRIX24_USER_ID = '1';
process.env.NODE_ENV = 'test';
process.env.PORT = '4001';

class E2ETestRunner {
  constructor() {
    this.serverProcess = null;
    this.serverUrl = 'http://localhost:4001';
    this.webhookUrl = 'https://test.bitrix24.ru/rest/1/webhook123';
    this.testResults = [];
    this.performanceResults = [];
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

  // Настройка полного мокинга Bitrix24
  setupBitrixMocking() {
    this.log('🎭 Настройка мокинга Bitrix24...', 'cyan');
    
    // Очищаем предыдущие моки
    nock.cleanAll();
    
    const bitrixScope = nock(this.webhookUrl);

    // 1. Поиск сделки по GUID - не найдена (новые сделки)
    bitrixScope
      .post('/crm.deal.list')
      .query(obj => obj.filter && obj.filter['UF_CRM_GUID_ORDER'] && !obj.filter['UF_CRM_GUID_ORDER'].includes('existing'))
      .reply(200, {
        result: [],
        total: 0,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 2. Поиск сделки по компании и пользователю - не найдена
    bitrixScope
      .post('/crm.deal.list')
      .query(obj => obj.filter && obj.filter['COMPANY_ID'])
      .reply(200, {
        result: [],
        total: 0,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 3. Поиск компании по ИНН - не найдена
    bitrixScope
      .post('/crm.company.list')
      .query(true)
      .reply(200, {
        result: [],
        total: 0,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 4. Получение пользователей
    bitrixScope
      .post('/user.get')
      .query(true)
      .reply(200, {
        result: [
          {
            ID: '1',
            NAME: 'Админ',
            LAST_NAME: 'Администратор',
            EMAIL: 'admin@test.ru'
          },
          {
            ID: '2', 
            NAME: 'Тест',
            LAST_NAME: 'Гладков',
            EMAIL: 'gladkov@test.ru'
          }
        ],
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 5. Создание компании
    bitrixScope
      .post('/crm.company.add')
      .query(true)
      .reply(200, {
        result: 100,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      })
      .persist();

    // 6. Создание сделки
    bitrixScope
      .post('/crm.deal.add')
      .query(true)
      .reply(200, {
        result: 200,
        time: { start: Date.now(), finish: Date.now(), duration: 0.3 }
      })
      .persist();

    // 7. Установка товаров в сделку
    bitrixScope
      .post('/crm.deal.productrows.set')
      .query(true)
      .reply(200, {
        result: true,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      })
      .persist();

    // 8. Обновление сделки
    bitrixScope
      .post('/crm.deal.update')
      .query(true)
      .reply(200, {
        result: true,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      })
      .persist();

    // 9. Мок для существующих сделок
    bitrixScope
      .post('/crm.deal.list')
      .query(obj => obj.filter && obj.filter['UF_CRM_GUID_ORDER'] && obj.filter['UF_CRM_GUID_ORDER'].includes('existing'))
      .reply(200, {
        result: [
          {
            ID: '300',
            TITLE: 'Существующая сделка',
            STAGE_ID: 'C1:NEW',
            COMPANY_ID: '100',
            ASSIGNED_BY_ID: '2',
            UF_CRM_GUID_ORDER: 'existing-guid-001'
          }
        ],
        total: 1,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 10. Поиск товаров сделки
    bitrixScope
      .post('/crm.deal.productrows.get')
      .query(true)
      .reply(200, {
        result: [
          {
            ID: '1',
            PRODUCT_NAME: 'Тестовый товар',
            QUANTITY: '5',
            PRICE: '1000'
          }
        ],
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    this.log('✅ Мокинг Bitrix24 настроен', 'green');
  }

  // Запуск сервера
  async startServer() {
    this.log('🚀 Запуск тестового сервера...', 'cyan');
    
    return new Promise((resolve, reject) => {
      this.serverProcess = spawn('node', ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: 'pipe'
      });

      this.serverProcess.stdout.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Сервер запущен на порту')) {
          this.log('✅ Сервер запущен на порту 4001', 'green');
          resolve();
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        console.error('Server error:', data.toString());
      });

      this.serverProcess.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('Сервер не запустился в течение 10 секунд'));
      }, 10000);
    });
  }

  // Остановка сервера
  stopServer() {
    if (this.serverProcess) {
      this.log('🛑 Остановка тестового сервера...', 'cyan');
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }

  // HTTP запрос
  makeRequest(endpoint, data, method = 'POST') {
    return new Promise((resolve, reject) => {
      const options = {
        url: `${this.serverUrl}${endpoint}`,
        method: method,
        json: true,
        body: data,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      request(options, (error, response, body) => {
        if (error) {
          reject(error);
        } else {
          resolve({ statusCode: response.statusCode, body });
        }
      });
    });
  }

  // Тест Health Check
  async testHealthCheck() {
    this.log('\n💓 E2E Тест: Health Check', 'cyan');
    
    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/health', {}, 'GET');
      const duration = Date.now() - startTime;
      
      this.performanceResults.push({
        test: 'Health Check',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.status === 'OK') {
        this.log('✅ Health Check работает', 'green');
        this.log(`   Время ответа: ${duration}мс`);
        return true;
      } else {
        this.log('❌ Health Check не работает', 'red');
        return false;
      }
    } catch (error) {
      this.log(`❌ Health Check ошибка: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест создания новой сделки
  async testCreateNewDeal() {
    this.log('\n📋 E2E Тест: Создание новой сделки', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: 'e2e-new-deal-001',
          Number_Order: 'E2ENEW001',
          Date_Order: '2025-08-06T10:00:00Z',
          CompanyINN: '1234567890',
          Responsible: 'Гладков А.',
          products: [
            { name: 'E2E Новый товар', quantity: 10, price: 2000 }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync/1c', testData);
      const duration = Date.now() - startTime;
      
      this.performanceResults.push({
        test: 'Create New Deal',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ Создание новой сделки успешно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        this.log(`   Deal ID: ${response.body.results[0].dealId}`);
        this.log(`   Действие: ${response.body.results[0].action}`);
        return true;
      } else {
        this.log('❌ Ошибка создания новой сделки', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ Исключение при создании: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест обновления существующей сделки
  async testUpdateExistingDeal() {
    this.log('\n🔄 E2E Тест: Обновление существующей сделки', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: 'existing-guid-001',
          Number_Order: 'EXISTING001',
          Date_Order: '2025-08-06T11:00:00Z',
          CompanyINN: '9876543210',
          Responsible: 'Администратор И.',
          products: [
            { name: 'Обновленный товар', quantity: 25, price: 2500 }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync/1c', testData);
      const duration = Date.now() - startTime;
      
      this.performanceResults.push({
        test: 'Update Existing Deal',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ Обновление существующей сделки успешно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        this.log(`   Deal ID: ${response.body.results[0].dealId}`);
        this.log(`   Действие: ${response.body.results[0].action}`);
        return true;
      } else {
        this.log('❌ Ошибка обновления сделки', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ Исключение при обновлении: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест множественных документов
  async testMultipleDocuments() {
    this.log('\n📦 E2E Тест: Множественные документы', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: 'e2e-multi-001',
          Number_Order: 'MULTI001',
          Date_Order: '2025-08-06T10:00:00Z',
          CompanyINN: '1111111111',
          Responsible: 'Гладков А.',
          products: [
            { name: 'Товар 1', quantity: 5, price: 1000 }
          ]
        },
        {
          type: 'Сделка',
          GUID_Order: 'e2e-multi-002',
          Number_Order: 'MULTI002',
          Date_Order: '2025-08-06T10:30:00Z',
          CompanyINN: '2222222222',
          Responsible: 'Администратор И.',
          products: [
            { name: 'Товар 2', quantity: 3, price: 1500 }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync/1c', testData);
      const duration = Date.now() - startTime;
      
      this.performanceResults.push({
        test: 'Multiple Documents',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success && response.body.processed === 2) {
        this.log('✅ Множественные документы обработаны', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        this.log(`   Обработано: ${response.body.processed} документов`);
        return true;
      } else {
        this.log('❌ Ошибка обработки множественных документов', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ Исключение при обработке: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест обработки ошибок
  async testErrorHandling() {
    this.log('\n⚠️ E2E Тест: Обработка ошибок', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'НеизвестныйТип',
          GUID_Order: 'error-test-001'
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync/1c', testData);
      const duration = Date.now() - startTime;
      
      this.performanceResults.push({
        test: 'Error Handling',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ Обработка ошибок работает корректно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        this.log(`   Сообщение: ${response.body.results[0].message}`);
        return true;
      } else {
        this.log('❌ Неправильная обработка ошибок', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ Исключение при обработке ошибки: ${error.message}`, 'red');
      return false;
    }
  }

  // Нагрузочное тестирование
  async testLoadPerformance() {
    this.log('\n⚡ E2E Тест: Нагрузочное тестирование', 'cyan');
    
    const concurrentRequests = 5;
    const promises = [];
    
    for (let i = 0; i < concurrentRequests; i++) {
      const testData = {
        Documents: [
          {
            type: 'Сделка',
            GUID_Order: `load-test-${i}`,
            Number_Order: `LOAD${String(i).padStart(3, '0')}`,
            Date_Order: '2025-08-06T10:00:00Z',
            CompanyINN: `${1000000000 + i}`,
            Responsible: 'Гладков А.',
            products: [
              { name: `Нагрузочный товар ${i}`, quantity: 1, price: 1000 }
            ]
          }
        ]
      };
      
      promises.push(this.makeRequest('/api/sync/1c', testData));
    }
    
    const startTime = Date.now();
    
    try {
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      const successful = results.filter(r => r.statusCode === 200 && r.body.success).length;
      
      this.performanceResults.push({
        test: 'Load Test',
        duration: duration,
        status: successful === concurrentRequests ? 200 : 500
      });
      
      this.log(`✅ Нагрузочный тест: ${successful}/${concurrentRequests} успешных запросов`, 'green');
      this.log(`   Общее время: ${duration}мс`);
      this.log(`   Среднее время на запрос: ${Math.round(duration / concurrentRequests)}мс`);
      
      return successful === concurrentRequests;
    } catch (error) {
      this.log(`❌ Ошибка нагрузочного теста: ${error.message}`, 'red');
      return false;
    }
  }

  // Отчет о производительности
  showPerformanceReport() {
    this.log('\n📊 ОТЧЕТ О ПРОИЗВОДИТЕЛЬНОСТИ', 'yellow');
    this.log('='.repeat(60), 'yellow');
    
    this.performanceResults.forEach(result => {
      const status = result.status === 200 ? '✅' : '❌';
      this.log(`${status} ${result.test.padEnd(20)}: ${String(result.duration).padStart(4)}мс (HTTP ${result.status})`);
    });
    
    if (this.performanceResults.length > 0) {
      const avgDuration = Math.round(
        this.performanceResults.reduce((sum, r) => sum + r.duration, 0) / this.performanceResults.length
      );
      this.log(`\n📈 Среднее время выполнения: ${avgDuration}мс`, 'cyan');
      
      const fastTests = this.performanceResults.filter(r => r.duration < 1000).length;
      const totalTests = this.performanceResults.length;
      this.log(`⚡ Быстрых тестов (< 1сек): ${fastTests}/${totalTests}`, 'cyan');
    }
  }

  // Запуск всех тестов
  async runAllTests() {
    this.log('🧪 ЗАПУСК ПОЛНЫХ E2E ТЕСТОВ', 'yellow');
    this.log('='.repeat(60), 'yellow');
    
    try {
      // 1. Настройка мокинга
      this.setupBitrixMocking();
      
      // 2. Запуск сервера
      await this.startServer();
      
      // 3. Пауза для полного запуска
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 4. Выполнение тестов
      const tests = [
        () => this.testHealthCheck(),
        () => this.testCreateNewDeal(),
        () => this.testUpdateExistingDeal(),
        () => this.testMultipleDocuments(),
        () => this.testErrorHandling(),
        () => this.testLoadPerformance()
      ];
      
      let passed = 0;
      let failed = 0;
      
      for (const test of tests) {
        try {
          const result = await test();
          if (result) {
            passed++;
          } else {
            failed++;
          }
        } catch (error) {
          this.log(`❌ Тест провалился с ошибкой: ${error.message}`, 'red');
          failed++;
        }
        
        // Пауза между тестами
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 5. Отчеты
      this.showPerformanceReport();
      
      this.log('\n' + '='.repeat(60), 'yellow');
      this.log(`🎉 E2E ТЕСТЫ ЗАВЕРШЕНЫ!`, 'green');
      this.log(`✅ Пройдено: ${passed}`, 'green');
      this.log(`❌ Провалено: ${failed}`, failed > 0 ? 'red' : 'green');
      
      if (failed === 0) {
        this.log('\n🚀 ВСЕ E2E ТЕСТЫ ПРОШЛИ УСПЕШНО!', 'green');
        this.log('🎯 API готов к работе в production!', 'green');
      } else {
        this.log('\n⚠️  ЕСТЬ ПРОВАЛИВШИЕСЯ ТЕСТЫ', 'red');
        this.log('🔧 Требуется дополнительная отладка', 'yellow');
      }
      
    } catch (error) {
      this.log(`💥 Критическая ошибка E2E тестов: ${error.message}`, 'red');
    } finally {
      // 6. Очистка
      this.stopServer();
      nock.cleanAll();
    }
  }
}

// Запуск тестера
const e2eRunner = new E2ETestRunner();

// Обработка сигналов завершения
process.on('SIGINT', () => {
  console.log('\n🛑 Принудительная остановка тестов...');
  e2eRunner.stopServer();
  nock.cleanAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  e2eRunner.stopServer();
  nock.cleanAll();
  process.exit(0);
});

// Запуск
e2eRunner.runAllTests().catch(error => {
  console.error('💥 Ошибка E2E тестов:', error);
  e2eRunner.stopServer();
  nock.cleanAll();
  process.exit(1);
});
