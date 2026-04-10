const express = require('express');
const { spawn } = require('child_process');
const request = require('request');
const Bitrix24Mock = require('./bitrix24Mock');

// Настройка тестового окружения
process.env.BITRIX24_WEBHOOK_URL = 'https://test.bitrix24.ru/rest/1/webhook123/';
process.env.BITRIX24_USER_ID = '1';
process.env.NODE_ENV = 'test';
process.env.PORT = '4001';

class E2ETestRunner {
  constructor() {
    this.mock = new Bitrix24Mock();
    this.serverProcess = null;
    this.serverUrl = 'http://localhost:4001';
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

  // Запуск сервера для E2E тестов
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
        if (output.includes('Server running on port')) {
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

      // Таймаут на запуск сервера
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

  // HTTP запрос к серверу
  makeRequest(endpoint, data) {
    return new Promise((resolve, reject) => {
      const options = {
        url: `${this.serverUrl}${endpoint}`,
        method: 'POST',
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

  // Тест создания новой сделки через HTTP
  async testHTTPNewDeal() {
    this.log('\n📋 E2E Тест: Создание новой сделки через HTTP', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'Сделка',
          GUID_Order: 'e2e-test-001',
          Number_Order: 'E2E001',
          Date_Order: '2025-08-06T10:00:00Z',
          CompanyINN: '1234567890',
          Responsible: 'Гладков А.',
          products: [
            { name: 'E2E Тестовый товар', quantity: 10, price: 2000 }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync', testData);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      this.performanceResults.push({
        test: 'HTTP New Deal',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ HTTP создание сделки успешно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        this.log(`   Deal ID: ${response.body.results[0].dealId}`);
        return true;
      } else {
        this.log('❌ HTTP ошибка создания сделки', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ HTTP исключение: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест обновления существующей сделки
  async testHTTPUpdateDeal() {
    this.log('\n🔄 E2E Тест: Обновление существующей сделки', 'cyan');
    
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
            { name: 'Обновленный E2E товар', quantity: 25, price: 2500 }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync', testData);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      this.performanceResults.push({
        test: 'HTTP Update Deal',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ HTTP обновление сделки успешно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        return true;
      } else {
        this.log('❌ HTTP ошибка обновления сделки', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ HTTP исключение: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест отгрузки
  async testHTTPShipment() {
    this.log('\n📦 E2E Тест: Обработка отгрузки', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'Отгрузка',
          GUID_Order: 'e2e-test-001',
          shipped: [
            { name: 'E2E Отгруженный товар', quantity: 5, price: 2000 }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync', testData);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      this.performanceResults.push({
        test: 'HTTP Shipment',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ HTTP отгрузка успешно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        return true;
      } else {
        this.log('❌ HTTP ошибка отгрузки', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ HTTP исключение: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест досрочного закрытия
  async testHTTPEarlyClosing() {
    this.log('\n🔒 E2E Тест: Досрочное закрытие', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'ЗакрытиеСделкиДосрочно',
          GUID_Document: 'e2e-close-001',
          NumberDocument: 'E2ECLOSE001',
          DateDocument: '2025-08-06T15:00:00Z',
          Orders: [
            { GUID_Order: 'e2e-test-001', Number_Order: 'E2E001', Date_Order: '2025-08-06T10:00:00Z' }
          ]
        }
      ]
    };

    const startTime = Date.now();
    
    try {
      const response = await this.makeRequest('/api/sync', testData);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      this.performanceResults.push({
        test: 'HTTP Early Closing',
        duration: duration,
        status: response.statusCode
      });
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ HTTP досрочное закрытие успешно', 'green');
        this.log(`   Время выполнения: ${duration}мс`);
        return true;
      } else {
        this.log('❌ HTTP ошибка досрочного закрытия', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ HTTP исключение: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест обработки ошибок HTTP
  async testHTTPErrorHandling() {
    this.log('\n⚠️ E2E Тест: Обработка ошибок HTTP', 'cyan');
    
    const testData = {
      Documents: [
        {
          type: 'НеизвестныйТип',
          GUID_Order: 'error-e2e-001'
        }
      ]
    };

    try {
      const response = await this.makeRequest('/api/sync', testData);
      
      if (response.statusCode === 200 && response.body.success) {
        this.log('✅ HTTP обработка ошибок работает', 'green');
        return true;
      } else {
        this.log('❌ HTTP неправильная обработка ошибок', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ HTTP исключение: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест нагрузки
  async testLoad() {
    this.log('\n⚡ E2E Тест: Нагрузочное тестирование', 'cyan');
    
    const concurrentRequests = 5;
    const promises = [];
    
    for (let i = 0; i < concurrentRequests; i++) {
      const testData = {
        Documents: [
          {
            type: 'Сделка',
            GUID_Order: `load-test-${i}`,
            Number_Order: `LOAD${i}`,
            Date_Order: '2025-08-06T10:00:00Z',
            CompanyINN: '1234567890',
            Responsible: 'Гладков А.',
            products: [
              { name: `Нагрузочный товар ${i}`, quantity: 1, price: 1000 }
            ]
          }
        ]
      };
      
      promises.push(this.makeRequest('/api/sync', testData));
    }
    
    const startTime = Date.now();
    
    try {
      const results = await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const successful = results.filter(r => r.statusCode === 200).length;
      
      this.log(`✅ Нагрузочный тест: ${successful}/${concurrentRequests} успешных запросов`, 'green');
      this.log(`   Общее время: ${duration}мс`);
      this.log(`   Среднее время на запрос: ${Math.round(duration / concurrentRequests)}мс`);
      
      return successful === concurrentRequests;
    } catch (error) {
      this.log(`❌ Ошибка нагрузочного теста: ${error.message}`, 'red');
      return false;
    }
  }

  // Тест health check
  async testHealthCheck() {
    this.log('\n💓 E2E Тест: Health Check', 'cyan');
    
    try {
      const response = await this.makeRequest('/health', {});
      
      if (response.statusCode === 200 && response.body.status === 'OK') {
        this.log('✅ Health Check работает', 'green');
        return true;
      } else {
        this.log('❌ Health Check не работает', 'red');
        console.log('Ответ:', response.body);
        return false;
      }
    } catch (error) {
      this.log(`❌ Health Check исключение: ${error.message}`, 'red');
      return false;
    }
  }

  // Отчет о производительности
  showPerformanceReport() {
    this.log('\n📊 ОТЧЕТ О ПРОИЗВОДИТЕЛЬНОСТИ', 'yellow');
    this.log('='.repeat(50), 'yellow');
    
    this.performanceResults.forEach(result => {
      const status = result.status === 200 ? '✅' : '❌';
      this.log(`${status} ${result.test}: ${result.duration}мс (HTTP ${result.status})`);
    });
    
    if (this.performanceResults.length > 0) {
      const avgDuration = Math.round(
        this.performanceResults.reduce((sum, r) => sum + r.duration, 0) / this.performanceResults.length
      );
      this.log(`\n📈 Среднее время выполнения: ${avgDuration}мс`, 'cyan');
    }
  }

  // Запуск всех E2E тестов
  async runAllTests() {
    this.log('🧪 ЗАПУСК E2E ТЕСТОВ С СЕРВЕРОМ', 'yellow');
    this.log('='.repeat(50), 'yellow');
    
    try {
      await this.startServer();
      
      // Пауза для полного запуска сервера
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const tests = [
        () => this.testHealthCheck(),
        () => this.testHTTPNewDeal(),
        () => this.testHTTPUpdateDeal(),
        () => this.testHTTPShipment(),
        () => this.testHTTPEarlyClosing(),
        () => this.testHTTPErrorHandling(),
        () => this.testLoad()
      ];
      
      let passed = 0;
      let failed = 0;
      
      for (const test of tests) {
        const result = await test();
        if (result) {
          passed++;
        } else {
          failed++;
        }
        // Пауза между тестами
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      this.showPerformanceReport();
      
      this.log('\n' + '='.repeat(50), 'yellow');
      this.log(`🎉 E2E ТЕСТЫ ЗАВЕРШЕНЫ!`, 'green');
      this.log(`✅ Пройдено: ${passed}`, 'green');
      this.log(`❌ Провалено: ${failed}`, failed > 0 ? 'red' : 'green');
      
      if (failed === 0) {
        this.log('\n🚀 ВСЕ ТЕСТЫ ПРОШЛИ УСПЕШНО!', 'green');
      } else {
        this.log('\n⚠️  ЕСТЬ ПРОВАЛИВШИЕСЯ ТЕСТЫ', 'red');
      }
      
    } catch (error) {
      this.log(`💥 Критическая ошибка E2E тестов: ${error.message}`, 'red');
    } finally {
      this.stopServer();
    }
  }
}

// Запуск E2E тестов
const e2eRunner = new E2ETestRunner();

// Обработка завершения процесса
process.on('SIGINT', () => {
  console.log('\n🛑 Принудительная остановка тестов...');
  e2eRunner.stopServer();
  process.exit(0);
});

process.on('SIGTERM', () => {
  e2eRunner.stopServer();
  process.exit(0);
});

e2eRunner.runAllTests().catch(error => {
  console.error('💥 Ошибка E2E тестов:', error);
  e2eRunner.stopServer();
  process.exit(1);
});
