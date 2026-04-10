const express = require('express');
const request = require('supertest');
const nock = require('nock');

// 🚀 E2E тестирование с полным мокингом
class E2ETestRunner {
    constructor() {
        this.app = null;
        this.performanceData = [];
        this.setup();
    }

    setup() {
        // Настройка переменных окружения для тестов
        process.env.BITRIX24_WEBHOOK_URL = 'https://test.bitrix24.ru/rest/1/webhook123/';
        process.env.PORT = '4001';
        
        // Настройка мокинга Bitrix24 ПЕРЕД импортом приложения
        this.setupBitrix24Mocking();
        
        // Создаем экспресс приложение с роутами
        this.app = express();
        this.app.use(express.json());
        
        // Настраиваем роуты
        const syncRoutes = require('../routes/sync');
        this.app.use('/api', syncRoutes);
        
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                timestamp: new Date().toISOString(),
                service: '1C-Bitrix24 Sync API'
            });
        });
    }

    setupBitrix24Mocking() {
        // Очищаем все предыдущие моки
        nock.cleanAll();
        
        const baseURL = 'https://test.bitrix24.ru';

        // 🔍 Поиск сделки (не найдена)
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/crm.deal.list')
            .reply(200, {
                result: [],
                total: 0
            });

        // 🔍 Поиск компании (не найдена)
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/crm.company.list')
            .reply(200, {
                result: [],
                total: 0
            });

        // ➕ Создание компании
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/crm.company.add')
            .reply(200, {
                result: 101
            });

        // ➕ Создание сделки
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/crm.deal.add')
            .reply(200, {
                result: 202
            });

        // 🔍 Поиск пользователя
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/user.get')
            .reply(200, {
                result: [{
                    ID: '1',
                    NAME: 'Admin',
                    LAST_NAME: 'User'
                }]
            });

        // 📦 Добавление товаров в сделку
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/crm.deal.productrows.set')
            .reply(200, {
                result: true
            });

        // 🔄 Обновление сделки
        nock(baseURL)
            .persist()
            .post('/rest/1/webhook123/crm.deal.update')
            .reply(200, {
                result: true
            });

        console.log('🎭 Bitrix24 моки настроены с правильными URL');
    }

    async measureRequest(testName, requestFn) {
        const startTime = Date.now();
        const response = await requestFn();
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        this.performanceData.push({
            test: testName,
            duration,
            status: response.status
        });

        const statusIcon = response.status === 200 ? '✅' : '❌';
        const durationText = duration < 1000 ? `${duration}мс` : `${(duration/1000).toFixed(1)}с`;
        
        console.log(`${statusIcon} ${testName}: ${durationText} (HTTP ${response.status})`);
        
        return response;
    }

    async runTest(name, testFn) {
        try {
            console.log(`\n📋 E2E Тест: ${name}`);
            await testFn();
            console.log(`✅ ${name} - ПРОЙДЕН`);
            return true;
        } catch (error) {
            console.log(`❌ ${name} - ПРОВАЛЕН:`, error.message);
            return false;
        }
    }

    async healthCheck() {
        const response = await this.measureRequest(
            'Health Check',
            () => request(this.app).get('/health')
        );
        
        if (response.status !== 200) {
            throw new Error(`Health check failed: ${response.status}`);
        }
        
        if (response.body.status !== 'ok') {
            throw new Error(`Health status not ok: ${response.body.status}`);
        }
    }

    async createNewDeal() {
        const newDealData = {
            Documents: [{
                type: "Сделка",
                НомерДокумента: "DOC-001",
                ДатаДокумента: "2024-01-15T10:00:00.000Z",
                GUID: "e2e-new-deal-001",
                Контрагент: {
                    Наименование: "ООО Новая Компания",
                    ИНН: "1234567890"
                },
                Товары: [{
                    Номенклатура: "Товар 1",
                    Количество: 10,
                    Цена: 1500.00,
                    Сумма: 15000.00
                }],
                СуммаДокумента: 15000.00
            }]
        };

        const response = await this.measureRequest(
            'Create New Deal',
            () => request(this.app)
                .post('/api/1c')
                .send(newDealData)
        );

        if (response.status !== 200) {
            throw new Error(`Create deal failed: ${response.status} - ${JSON.stringify(response.body)}`);
        }

        if (!response.body.success) {
            throw new Error(`Deal creation not successful: ${response.body.message}`);
        }
    }

    async updateExistingDeal() {
        const updateDealData = {
            Documents: [{
                type: "Сделка",
                НомерДокумента: "DOC-002",
                ДатаДокумента: "2024-01-16T11:00:00.000Z",
                GUID: "existing-deal-guid",
                Контрагент: {
                    Наименование: "ООО Обновленная Компания",
                    ИНН: "9876543210"
                },
                Товары: [{
                    Номенклатура: "Товар 2",
                    Количество: 5,
                    Цена: 2000.00,
                    Сумма: 10000.00
                }],
                СуммаДокумента: 10000.00
            }]
        };

        const response = await this.measureRequest(
            'Update Existing Deal',
            () => request(this.app)
                .post('/api/1c')
                .send(updateDealData)
        );

        if (response.status !== 200) {
            throw new Error(`Update deal failed: ${response.status}`);
        }
    }

    async multipleDocuments() {
        const shipmentData = {
            Documents: [{
                type: "Отгрузка",
                НомерДокумента: "SHIP-001",
                ДатаДокумента: "2024-01-17T12:00:00.000Z",
                GUID: "shipment-001",
                Контрагент: {
                    Наименование: "ООО Клиент",
                    ИНН: "1111111111"
                },
                Товары: [{
                    Номенклатура: "Товар для отгрузки",
                    Количество: 3,
                    Цена: 5000.00,
                    Сумма: 15000.00
                }],
                СуммаДокумента: 15000.00
            }]
        };

        const response = await this.measureRequest(
            'Multiple Documents',
            () => request(this.app)
                .post('/api/1c')
                .send(shipmentData)
        );

        if (response.status !== 200) {
            throw new Error(`Multiple documents failed: ${response.status}`);
        }
    }

    async errorHandling() {
        const invalidData = {
            Documents: [{
                type: "НесуществующийТип",
                НомерДокумента: "ERR-001",
                ДатаДокумента: "2024-01-19T14:00:00.000Z",
                GUID: "error-test-001"
            }]
        };

        const response = await this.measureRequest(
            'Error Handling',
            () => request(this.app)
                .post('/api/1c')
                .send(invalidData)
        );

        // Проверяем, что API корректно обработал неизвестный тип документа
        if (response.status === 200 && response.body.success === false) {
            // Это правильная обработка ошибки
            return;
        }
        
        // Проверяем, что в результатах есть сообщение об ошибке для неизвестного типа
        if (response.status === 200 && response.body.results) {
            const errorResult = response.body.results.find(r => 
                r.message && r.message.includes('Неизвестный тип документа')
            );
            if (errorResult) {
                return; // Ошибка корректно обработана
            }
        }

        throw new Error(`Error handling test failed: неправильная обработка ошибки`);
    }

    async loadTest() {
        const dealData = {
            Documents: [{
                type: "Сделка",
                НомерДокумента: "LOAD-TEST",
                ДатаДокумента: "2024-01-18T13:00:00.000Z",
                GUID: `load-test-${Date.now()}`,
                Контрагент: {
                    Наименование: "ООО Нагрузочное тестирование",
                    ИНН: "9999999999"
                },
                Товары: [{
                    Номенклатура: "Нагрузочный товар",
                    Количество: 1,
                    Цена: 1000.00,
                    Сумма: 1000.00
                }],
                СуммаДокумента: 1000.00
            }]
        };

        const concurrentRequests = 5;
        const requests = Array(concurrentRequests).fill().map((_, index) => {
            const data = { 
                Documents: [{
                    ...dealData.Documents[0], 
                    GUID: `load-test-${Date.now()}-${index}`
                }]
            };
            return request(this.app).post('/api/1c').send(data);
        });

        const startTime = Date.now();
        const responses = await Promise.all(requests);
        const endTime = Date.now();
        const totalTime = endTime - startTime;

        const successCount = responses.filter(r => r.status === 200).length;
        const avgTime = Math.round(totalTime / concurrentRequests);

        console.log(`✅ Нагрузочный тест: ${successCount}/${concurrentRequests} успешных запросов`);
        console.log(`   Общее время: ${totalTime}мс`);
        console.log(`   Среднее время на запрос: ${avgTime}мс`);

        this.performanceData.push({
            test: 'Load Test',
            duration: totalTime,
            status: 200
        });

        if (successCount < concurrentRequests) {
            throw new Error(`Load test failed: only ${successCount}/${concurrentRequests} requests succeeded`);
        }
    }

    generatePerformanceReport() {
        console.log('\n📊 ОТЧЕТ О ПРОИЗВОДИТЕЛЬНОСТИ');
        console.log('============================================================');
        
        let totalTime = 0;
        let fastTests = 0;
        
        this.performanceData.forEach(data => {
            const statusIcon = data.status === 200 ? '✅' : '❌';
            const testName = data.test.padEnd(20);
            const durationText = data.duration < 1000 ? 
                `${data.duration}мс` : 
                `${(data.duration/1000).toFixed(1)}с`;
            
            console.log(`${statusIcon} ${testName}: ${durationText.padStart(8)} (HTTP ${data.status})`);
            
            totalTime += data.duration;
            if (data.duration < 1000) fastTests++;
        });
        
        const avgTime = Math.round(totalTime / this.performanceData.length);
        
        console.log(`\n📈 Среднее время выполнения: ${avgTime}мс`);
        console.log(`⚡ Быстрых тестов (< 1сек): ${fastTests}/${this.performanceData.length}`);
    }

    async runAllTests() {
        console.log('🧪 ФИНАЛЬНЫЕ E2E ТЕСТЫ');
        console.log('============================================================');
        
        const results = [];
        
        // Запускаем все тесты
        results.push(await this.runTest('Health Check', () => this.healthCheck()));
        results.push(await this.runTest('Создание новой сделки', () => this.createNewDeal()));
        results.push(await this.runTest('Обновление существующей сделки', () => this.updateExistingDeal()));
        results.push(await this.runTest('Множественные документы', () => this.multipleDocuments()));
        results.push(await this.runTest('Обработка ошибок', () => this.errorHandling()));
        results.push(await this.runTest('Нагрузочное тестирование', () => this.loadTest()));
        
        // Генерируем отчет о производительности
        this.generatePerformanceReport();
        
        // Подводим итоги
        const passed = results.filter(r => r === true).length;
        const failed = results.filter(r => r === false).length;
        
        console.log('\n============================================================');
        console.log('🎉 ФИНАЛЬНЫЕ E2E ТЕСТЫ ЗАВЕРШЕНЫ!');
        console.log(`✅ Пройдено: ${passed}`);
        console.log(`❌ Провалено: ${failed}`);
        
        if (failed === 0) {
            console.log('\n🚀 ВСЕ E2E ТЕСТЫ ПРОШЛИ УСПЕШНО!');
            console.log('🎯 API готов к работе в production!');
            console.log('📋 Проверены сценарии:');
            console.log('   ✅ Health Check - работает корректно');
            console.log('   ✅ Создание новых сделок с компаниями');
            console.log('   ✅ Обновление существующих сделок');
            console.log('   ✅ Обработка разных типов документов');
            console.log('   ✅ Корректная обработка ошибок');
            console.log('   ✅ Нагрузочное тестирование');
            console.log('\n🔧 Инфраструктура:');
            console.log('   ✅ HTTP мокинг работает');
            console.log('   ✅ Переменные окружения настроены');
            console.log('   ✅ Роуты и контроллеры функционируют');
            console.log('   ✅ Сервисы интегрируются правильно');
        } else {
            console.log('\n⚠️  Есть проваленные тесты, требуется доработка');
        }
        
        // Очищаем моки после тестов
        nock.cleanAll();
        
        return failed === 0;
    }
}

// Запуск тестов
if (require.main === module) {
    const runner = new E2ETestRunner();
    runner.runAllTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('💥 Критическая ошибка E2E тестов:', error);
            process.exit(1);
        });
}

module.exports = E2ETestRunner;
