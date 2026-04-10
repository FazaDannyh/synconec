const nock = require('nock');
const axios = require('axios');

// Мок данные для имитации ответов Битрикс24
class Bitrix24Mock {
  constructor() {
    this.webhookUrl = 'https://test.bitrix24.ru/rest/1/webhook123';
    this.setupMocks();
  }

  setupMocks() {
    // Мокируем все запросы к Битрикс24
    const bitrixScope = nock(this.webhookUrl);

    // 1. Поиск сделки по GUID - не найдена (для новых сделок)
    bitrixScope
      .post('/crm.deal.list')
      .query(obj => obj.filter && obj.filter['UF_CRM_GUID_ORDER'] && !obj.filter['UF_CRM_GUID_ORDER'].includes('existing'))
      .reply(200, {
        result: [],
        total: 0,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 1.1. Поиск сделки по компании и пользователю - не найдена
    bitrixScope
      .post('/crm.deal.list')
      .query(obj => obj.filter && obj.filter['COMPANY_ID'] && obj.filter['ASSIGNED_BY_ID'])
      .reply(200, {
        result: [],
        total: 0,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 2. Поиск компании по ИНН - не найдена
    bitrixScope
      .post('/crm.company.list')
      .query(true)
      .reply(200, {
        result: [],
        total: 0,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      })
      .persist();

    // 3. Получение пользователей
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

    // 4. Создание компании
    bitrixScope
      .post('/crm.company.add')
      .query(true)
      .reply(200, {
        result: 100,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      })
      .persist();

    // 5. Создание сделки
    bitrixScope
      .post('/crm.deal.add')
      .query(true)
      .reply(200, {
        result: 200,
        time: { start: Date.now(), finish: Date.now(), duration: 0.3 }
      })
      .persist();

    // 6. Установка товаров в сделку
    bitrixScope
      .post('/crm.deal.productrows.set')
      .query(true)
      .reply(200, {
        result: true,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      })
      .persist();

    // 7. Обновление сделки
    bitrixScope
      .post('/crm.deal.update')
      .query(true)
      .reply(200, {
        result: true,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      })
      .persist();

    // 8. Получение товаров сделки
    bitrixScope
      .post('/crm.deal.productrows.get')
      .query(true)
      .reply(200, {
        result: [
          {
            ID: '1',
            PRODUCT_NAME: 'Тестовый товар 1',
            QUANTITY: '10',
            PRICE: '1000'
          }
        ],
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      });

    // 9. Поиск сделки по GUID - найдена (для отгрузки)
    bitrixScope
      .post('/crm.deal.list')
      .query(obj => obj.filter && obj.filter['UF_CRM_GUID_ORDER'])
      .reply(200, {
        result: [
          {
            ID: '200',
            TITLE: 'Тестовая сделка',
            STAGE_ID: 'C1:PREPARATION',
            COMPANY_ID: '100',
            ASSIGNED_BY_ID: '2',
            UF_CRM_GUID_ORDER: 'test-guid-001'
          }
        ],
        total: 1,
        time: { start: Date.now(), finish: Date.now(), duration: 0.1 }
      });

    return bitrixScope;
  }

  // Сброс моков для следующего теста
  reset() {
    nock.cleanAll();
    this.setupMocks();
  }

  // Настройка мока для ошибки
  setupErrorMock(method, error) {
    const bitrixScope = nock(this.webhookUrl);
    bitrixScope
      .post(`/${method}`)
      .query(true)
      .reply(400, {
        error: 'ERROR_CORE',
        error_description: error
      });
    return bitrixScope;
  }

  // Настройка мока для поиска существующей сделки
  setupExistingDealMock() {
    nock.cleanAll();
    const bitrixScope = nock(this.webhookUrl);

    // Сделка найдена
    bitrixScope
      .post('/crm.deal.list')
      .query(true)
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
      });

    // Обновление сделки
    bitrixScope
      .post('/crm.deal.update')
      .query(true)
      .reply(200, {
        result: true,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      });

    // Установка товаров
    bitrixScope
      .post('/crm.deal.productrows.set')
      .query(true)
      .reply(200, {
        result: true,
        time: { start: Date.now(), finish: Date.now(), duration: 0.2 }
      });

    return bitrixScope;
  }
}

module.exports = Bitrix24Mock;
