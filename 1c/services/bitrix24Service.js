const config = require('../config');
const axios = require('axios');

class Bitrix24Service {
  constructor() {
    this.webhookUrl = config.bitrix24.webhookUrl;
    
    if (!this.webhookUrl) {
      throw new Error('BITRIX24_WEBHOOK_URL не настроен в переменных окружения');
    }
  }

  // Базовый метод для выполнения запросов к Битрикс24
  async callMethod(method, params = {}) {
    try {
      const url = `${this.webhookUrl}${method}`;
      const response = await axios.post(url, params);
      
      if (response.data.error) {
        throw new Error(`Битрикс24 API ошибка: ${response.data.error_description}`);
      }
      
      return response.data.result;
    } catch (error) {
      console.error(`Ошибка вызова метода ${method}:`, error.message);
      throw error;
    }
  }

  // Поиск сделки по GUID в пользовательском поле
  async findDealByGUID(guid) {
    try {
      const deals = await this.callMethod('crm.deal.list', {
        filter: {
          [config.dealFields.guid]: guid
        },
        select: ['ID', 'TITLE', 'STAGE_ID', 'CATEGORY_ID', 'COMPANY_ID', 'ASSIGNED_BY_ID', config.dealFields.guid]
      });
      
      return deals.length > 0 ? deals[0] : null;
    } catch (error) {
      console.error('Ошибка поиска сделки по GUID:', error);
      return null;
    }
  }

  // Поиск компании по ИНН
  async findCompanyByINN(inn) {
    try {
      const companies = await this.callMethod('crm.company.list', {
        filter: {
          [config.companyFields.inn]: inn
        },
        select: ['ID', 'TITLE', config.companyFields.inn]
      });
      
      return companies.length > 0 ? companies[0] : null;
    } catch (error) {
      console.error('Ошибка поиска компании по ИНН:', error);
      return null;
    }
  }

  // Поиск пользователя по фамилии
  async findUserByLastName(lastName) {
    try {
      const users = await this.callMethod('user.search', {
        filter: {
          'LAST_NAME': lastName
        }
      });
      
      return users.length > 0 ? users[0] : null;
    } catch (error) {
      console.error('Ошибка поиска пользователя по фамилии:', error);
      return null;
    }
  }

  // Получение пользователя по ID (для UF_DEPARTMENT)
  async getUserById(userId) {
    try {
      const result = await this.callMethod('user.get', { ID: Number(userId) });
      // Некоторые порталы могут возвращать массив, некоторые — объект
      if (!result) return null;
      if (Array.isArray(result)) return result[0] || null;
      return result;
    } catch (error) {
      console.error('Ошибка получения пользователя по ID:', error);
      return null;
    }
  }

  // Поиск сделки по компании и ответственному (опционально с учётом CATEGORY_ID)
  async findDealByCompanyAndUser(companyId, userId, options = {}) {
    try {
      const { categoryId } = options || {};
      const filter = {
        COMPANY_ID: companyId,
        ASSIGNED_BY_ID: userId,
        CLOSED: 'N',
        STAGE_SEMANTIC_ID: 'P', // только активные стадии
      };
      if (categoryId != null) filter.CATEGORY_ID = Number(categoryId);

      const deals = await this.callMethod('crm.deal.list', {
        filter,
        select: ['ID', 'TITLE', 'STAGE_ID', 'CATEGORY_ID', 'COMPANY_ID', 'ASSIGNED_BY_ID', config.dealFields.guid],
        order: { DATE_CREATE: 'DESC' }
      });
      
      const guidField = config.dealFields.guid;
      const candidate = Array.isArray(deals) ? deals.find(d => !d[guidField] || String(d[guidField]).trim() === '') : null;
      return candidate || null;
    } catch (error) {
      console.error('Ошибка поиска сделки по компании и пользователю:', error);
      return null;
    }
  }

  // Создание новой сделки
  async createDeal(dealData) {
    try {
      const result = await this.callMethod('crm.deal.add', {
        fields: dealData
      });
      
      return result;
    } catch (error) {
      console.error('Ошибка создания сделки:', error);
      throw error;
    }
  }

  // Обновление сделки
  async updateDeal(dealId, dealData) {
    try {
      const result = await this.callMethod('crm.deal.update', {
        id: dealId,
        fields: dealData
      });
      
      return result;
    } catch (error) {
      console.error('Ошибка обновления сделки:', error);
      throw error;
    }
  }

  // Добавление товаров к сделке
  async addProductsToDeal(dealId, products) {
    try {
      if (!products || !Array.isArray(products) || products.length === 0) {
        console.log('Нет товаров для добавления к сделке');
        return { success: true, message: 'Нет товаров для добавления' };
      }

      const toNum = (v) => {
        if (typeof v === 'number') return v;
        if (v == null) return 0;
        const s = String(v).replace(/\s+/g, '').replace(',', '.');
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : 0;
      };

      const productRows = products.map((product, index) => {
        const qty = Number(product.quantity || 0);
        const pricePerUnit = toNum(product.price ?? product.PRICE);
        const summaFinal = toNum(product.summa_final);
        const discount = toNum(product.skidka);
        
        // summa_final — это итоговая сумма строки (уже перемноженная), вычисляем цену за штуку
        const finalPrice = summaFinal > 0 && qty > 0 
          ? Math.round((summaFinal / qty) * 100) / 100 
          : pricePerUnit;
        
        const row = {
          PRODUCT_ID: product.id || product.PRODUCT_ID || undefined,
          PRODUCT_NAME: product.name,
          QUANTITY: qty,
          PRICE: finalPrice,
          SORT: index * 10,
        };
        
        // Добавляем скидку если есть
        if (discount > 0) {
          row.DISCOUNT_TYPE_ID = 1; // 1 = процент, 2 = абсолютная
          row.DISCOUNT_RATE = discount;
        }
        
        return row;
      });

      const result = await this.callMethod('crm.deal.productrows.set', {
        id: dealId,
        rows: productRows,
      });
      
      return result;
    } catch (error) {
      console.error('Ошибка добавления товаров к сделке:', error);
      throw error;
    }
  }

  // Получение товаров сделки
  async getDealProducts(dealId) {
    try {
      const result = await this.callMethod('crm.deal.productrows.get', {
        id: dealId
      });
      
      return result;
    } catch (error) {
      console.error('Ошибка получения товаров сделки:', error);
      return [];
    }
  }

  // Создание компании
  async createCompany(companyData) {
    try {
      const result = await this.callMethod('crm.company.add', {
        fields: companyData
      });
      
      return result;
    } catch (error) {
      console.error('Ошибка создания компании:', error);
      throw error;
    }
  }

  // Получение этапов воронки сделок
  async getDealStages() {
    try {
      const result = await this.callMethod('crm.status.list', {
        filter: {
          'ENTITY_ID': 'DEAL_STAGE'
        }
      });
      
      return result;
    } catch (error) {
      console.error('Ошибка получения этапов сделки:', error);
      return [];
    }
  }

  // Получение списка пользователей
  async getUsers() {
    try {
      const result = await this.callMethod('user.get');
      return result;
    } catch (error) {
      console.error('Ошибка получения пользователей:', error);
      return [];
    }
  }

  // Поиск пользователя по имени/фамилии (более гибкий поиск)
  async findUserByName(searchName) {
    try {
      const users = await this.getUsers();
      console.log(users)
      // Ищем по фамилии, имени или полному имени
      const foundUser = users.find(user => {
        const fullName = `${user.LAST_NAME} ${user.NAME}`.toLowerCase();
        const searchLower = searchName.toLowerCase();
        
        return user.LAST_NAME && user.LAST_NAME.toLowerCase().includes(searchLower) ||
               user.NAME && user.NAME.toLowerCase().includes(searchLower) ||
               fullName.includes(searchLower);
      });
      
      return foundUser || null;
    } catch (error) {
      console.error('Ошибка поиска пользователя по имени:', error);
      return null;
    }
  }

  // Получение полных данных сделки
  async getDeal(dealId) {
    try {
      const result = await this.callMethod('crm.deal.get', { id: dealId });
      return result;
    } catch (error) {
      console.error('Ошибка получения сделки:', error);
      throw error;
    }
  }

  // Установка/добавление строк в множественное строковое пользовательское поле сделки
  async setDealMultipleStringField(dealId, fieldCode, lines = [], { append = false } = {}) {
    try {
      let values = Array.isArray(lines) ? lines.filter(Boolean).map(String) : [];

      if (append) {
        const deal = await this.getDeal(dealId);
        const existing = deal[fieldCode];
        const existingArr = Array.isArray(existing) ? existing.map(String) : (existing ? [String(existing)] : []);
        values = [...existingArr, ...values];
      }

      return await this.updateDeal(dealId, { [fieldCode]: values });
    } catch (error) {
      console.error(`Ошибка обновления поля ${fieldCode} у сделки ${dealId}:`, error);
      throw error;
    }
  }

  // Инкрементальное обновление товарных позиций (product rows)
  async incrementDealProductRows(dealId, shippedProducts = []) {
    try {
      const currentRows = await this.getDealProducts(dealId);

      // Индексация существующих строк: сначала по PRODUCT_ID, затем по названию
      const normalize = (s) => (s || '').toString().trim().toLowerCase();
      const indexById = new Map();
      const indexByName = new Map();
      currentRows.forEach((row, idx) => {
        const idKey = row.PRODUCT_ID != null ? String(row.PRODUCT_ID) : null;
        if (idKey) indexById.set(idKey, idx);
        indexByName.set(normalize(row.PRODUCT_NAME), idx);
      });

      let maxSort = currentRows.reduce((m, r) => Math.max(m, Number(r.SORT || 0)), 0);

      for (const item of (shippedProducts || [])) {
        const itemId = item.id ?? item.ID ?? item.ProductId ?? item.PRODUCT_ID;
        const idKey = itemId != null ? String(itemId) : null;
        const nameKey = normalize(item.name ?? item.PRODUCT_NAME);
        const matchIdx = (idKey && indexById.has(idKey))
          ? indexById.get(idKey)
          : (indexByName.has(nameKey) ? indexByName.get(nameKey) : -1);

        if (matchIdx >= 0) {
          const row = currentRows[matchIdx];
          const newQty = Number(row.QUANTITY || 0) + Number(item.quantity ?? item.QUANTITY ?? 0);
          currentRows[matchIdx] = {
            ...row,
            PRODUCT_ID: row.PRODUCT_ID ?? (idKey ? Number(idKey) : undefined),
            PRODUCT_NAME: row.PRODUCT_NAME ?? (item.name ?? ''),
            QUANTITY: newQty,
            PRICE: Number(row.PRICE ?? item.price ?? item.PRICE ?? 0),
          };
        } else {
          maxSort += 10;
          currentRows.push({
            PRODUCT_ID: idKey ? Number(idKey) : undefined,
            PRODUCT_NAME: item.name ?? item.PRODUCT_NAME ?? 'Товар',
            QUANTITY: Number(item.quantity ?? item.QUANTITY ?? 0),
            PRICE: Number(item.price ?? item.PRICE ?? 0),
            SORT: maxSort,
          });
          if (idKey) indexById.set(idKey, currentRows.length - 1);
          indexByName.set(nameKey, currentRows.length - 1);
        }
      }

      await this.callMethod('crm.deal.productrows.set', {
        id: dealId,
        rows: currentRows,
      });

      return currentRows;
    } catch (error) {
      console.error('Ошибка инкрементального обновления товаров сделки:', error);
      throw error;
    }
  }

  async addDealComment(dealId, comment) {
    try {
      const result = await this.callMethod('crm.timeline.comment.add', {
        fields: {
          ENTITY_ID: Number(dealId),
          ENTITY_TYPE: 'deal',
          COMMENT: comment,
        },
      });

      if (result) {
        if (config.logging && config.logging.logApiCalls) {
          console.log(`Комментарий добавлен к сделке ${dealId}`);
        }
        return result;
      } else {
        throw new Error('Не удалось добавить комментарий к сделке');
      }
    } catch (error) {
      console.error('Ошибка добавления комментария к сделке:', error);
      throw error;
    }
  }

  // Поиск компании по ИНН в реквизитах (RQ_INN)
  async findCompanyByINNInRequisites(inn) {
    try {
      if (!inn) return null;
      // ENTITY_TYPE_ID: 4 — компания
      const reqs = await this.callMethod('crm.requisite.list', {
        filter: { RQ_INN: String(inn).trim(), ENTITY_TYPE_ID: 4 },
        select: ['ID', 'ENTITY_ID', 'RQ_INN']
      });
      if (!reqs || reqs.length === 0) return null;
      const entityId = reqs[0].ENTITY_ID;
      if (!entityId) return null;
      return await this.getCompanyById(entityId);
    } catch (error) {
      console.error('Ошибка поиска компании по ИНН в реквизитах:', error);
      return null;
    }
  }

  async getCompanyById(id) {
    try {
      const company = await this.callMethod('crm.company.get', { id: Number(id) });
      return company || null;
    } catch (error) {
      console.error('Ошибка получения компании по ID:', error);
      return null;
    }
  }
}

module.exports = Bitrix24Service;

  // Добавление комментария к сделке через timeline
