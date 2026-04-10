const Bitrix24Service = require('../services/bitrix24Service');
const config = require('../config');

class SyncController {
  constructor() {
    this.bitrix24 = new Bitrix24Service();
  }

  // Основной метод синхронизации
  async syncWith1C(req, res) {
    try {
      const { Documents } = req.body;
      
      if (!Documents || !Array.isArray(Documents)) {
        return res.status(400).json({
          success: false,
          message: 'Неверный формат данных. Ожидается массив Documents'
        });
      }

      const results = [];

      for (const document of Documents) {
        try {
          let result;
          
          switch (document.type) {
            case 'Сделка':
              result = await this.processDeal(document);
              break;
            case 'Отгрузка':
              result = await this.processShipment(document);
              break;
            case 'ЗакрытиеСделкиДосрочно':
              result = await this.processEarlyClosing(document);
              break;
            default:
              result = {
                success: false,
                message: `Неизвестный тип документа: ${document.type}`
              };
          }
          
          results.push({
            documentType: document.type,
            guid: document.GUID_Order || document.GUID_Document,
            ...result
          });
          
        } catch (error) {
          console.error(`Ошибка обработки документа ${document.type}:`, error);
          results.push({
            documentType: document.type,
            guid: document.GUID_Order || document.GUID_Document,
            success: false,
            message: error.message
          });
        }
      }

      res.json({
        success: true,
        processed: results.length,
        results
      });

    } catch (error) {
      console.error('Ошибка синхронизации:', error);
      res.status(500).json({
        success: false,
        message: 'Внутренняя ошибка сервера',
        error: error.message
      });
    }
  }

  // Обработка документа "Сделка"
  async processDeal(document) {
    const {
      GUID_Order,
      Number_Order,
      Date_Order,
      Company,
      CompanyINN,
      Client,
      ClientINN,
      Responsible,
      products = []
    } = document;

    let deal = await this.bitrix24.findDealByGUID(GUID_Order);

    const { lines: orderLines, total: invoiceTotal } = this.buildProductStringsAndSum(products, { includeId: true });

    if (deal) {
      // Определяем стадии из категории сделки (если уже есть категория)
      const stages = config.getStagesForCategoryId(deal.CATEGORY_ID);

      await this.bitrix24.addProductsToDeal(deal.ID, products);
      await this.bitrix24.updateDeal(deal.ID, {
        STAGE_ID: stages.invoice,
        [config.dealFields.orderProductsStrings]: orderLines,
        [config.dealFields.invoiceSum]: String(invoiceTotal)
      });

      await this.bitrix24.addDealComment(
        deal.ID,
        this.buildSystemComment('Обновлены товары из счета', { number: Number_Order, date: Date_Order, total: invoiceTotal, lines: orderLines })
      );

      return { success: true, action: 'updated', dealId: deal.ID, message: 'Сделка обновлена' };
    }

    // 2. Ищем/создаем компанию по ИНН
    const inn = ClientINN || CompanyINN;
    let company = null;
    let emptyInnWarning = false;
    
    if (inn) {
      // Сначала ищем по реквизитам (RQ_INN), затем по UF поле компании
      company = await this.bitrix24.findCompanyByINNInRequisites(inn);
      if (!company) {
        company = await this.bitrix24.findCompanyByINN(inn);
      }
      if (!company) {
        // Если не нашли — создаём компанию
        const title = Company || Client || `Компания ${inn}`;
        const companyData = { TITLE: title };
        companyData[config.companyFields.inn] = String(inn);
        const companyId = await this.bitrix24.createCompany(companyData);
        company = { ID: companyId, TITLE: title };
      }
    } else {
      // ИНН пустой — сделку создадим без привязки к компании
      emptyInnWarning = true;
    }

    // 3. Ищем ответственного по фамилии
    const lastName = this.extractLastName(Responsible);
    const user = lastName ? await this.bitrix24.findUserByName(lastName) : null;
    if (config.isDevelopment()) {
      console.log('[sync] responsible:', Responsible, '→ lastName:', lastName, '→ user:', user && {ID: user.ID, NAME: user.NAME, LAST_NAME: user.LAST_NAME});
    }
    if (!user || !user.ID) {
      throw new Error('Ответственный не найден по переданным данным');
    }
    
    const assignedUserId = user.ID;

    // Получаем департаменты ответственного и определяем категорию сделки
    const userFull = await this.bitrix24.getUserById(assignedUserId);
    const deptIds = (userFull && userFull.UF_DEPARTMENT) ? userFull.UF_DEPARTMENT : [];
    if (config.isDevelopment()) {
      console.log('[sync] user.UF_DEPARTMENT:', deptIds);
    }
    const categoryId = config.resolveCategoryByDepartments(deptIds);
    if (config.isDevelopment()) {
      console.log('[sync] resolved CATEGORY_ID:', categoryId);
    }
    const stages = config.getStagesForCategoryId(categoryId);

    // 4. Ищем существующую сделку с этой компанией и ответственным (только если есть компания)
    let existingDeal = null;
    if (company) {
      existingDeal = await this.bitrix24.findDealByCompanyAndUser(company.ID, assignedUserId, { categoryId });
    }
    
    if (existingDeal) {
      // Если у найденной сделки уже установлен GUID, не перезаписываем — пропускаем
      const guidField = config.dealFields.guid;
      if (existingDeal[guidField]) {
        // Переходим к созданию новой сделки ниже
      } else {
        // Обновляем существующую сделку без GUID, привязываем к текущему заказу
        // Сначала обновим товарные позиции, как в ветке обновления по GUID
        await this.bitrix24.addProductsToDeal(existingDeal.ID, products);

        // Затем проставим GUID, категорию, стадию и UF-поля со строками и суммой счета
        await this.bitrix24.updateDeal(existingDeal.ID, {
          [config.dealFields.guid]: GUID_Order,
          CATEGORY_ID: existingDeal.CATEGORY_ID ?? categoryId,
          STAGE_ID: config.getStagesForCategoryId(existingDeal.CATEGORY_ID ?? categoryId).invoice,
          [config.dealFields.orderProductsStrings]: orderLines,
          [config.dealFields.invoiceSum]: String(invoiceTotal)
        });

        // Добавим системный комментарий для единообразия
        await this.bitrix24.addDealComment(
          existingDeal.ID,
          this.buildSystemComment('Обновлены товары из счета', { number: Number_Order, date: Date_Order, total: invoiceTotal, lines: orderLines })
        );
        
        return {
          success: true,
          action: 'linked',
          dealId: existingDeal.ID,
          message: 'Существующая сделка без GUID связана с 1С'
        };
      }
    }

    // 5. Создаем новую сделку
    const commentsBase = `Создано из 1С.${Number_Order ? ` Номер: ${Number_Order}` : ''}${Date_Order ? `, Дата: ${Date_Order}` : ''}`;
    const dealData = {
      TITLE: `Сделка ${Number_Order || 'без номера'}`,
      ASSIGNED_BY_ID: assignedUserId,
      CATEGORY_ID: categoryId,
      STAGE_ID: stages.invoice,
      [config.dealFields.guid]: GUID_Order,
      COMMENTS: emptyInnWarning 
        ? `⚠️ Пришел пустой ИНН: нужно привязать к компании!\n${commentsBase}`
        : commentsBase
    };
    
    // Привязываем к компании только если она есть
    if (company) {
      dealData.COMPANY_ID = company.ID;
    }
    
    const dealId = await this.bitrix24.createDeal(dealData);

    await this.bitrix24.addProductsToDeal(dealId, products);

    await this.bitrix24.updateDeal(dealId, {
      [config.dealFields.orderProductsStrings]: orderLines,
      [config.dealFields.invoiceSum]: String(invoiceTotal),
      [config.dealFields.shippedProductsStrings]: [],
      [config.dealFields.shippedSum]: String(0)
    });

    const dealComment = this.formatDocumentComment(document, 'сделка');
    await this.bitrix24.addDealComment(dealId, dealComment);
    
    // Если ИНН был пустой — добавляем предупреждающий комментарий
    if (emptyInnWarning) {
      await this.bitrix24.addDealComment(
        dealId,
        '⚠️ ВНИМАНИЕ: Пришел пустой ИНН! Необходимо вручную привязать сделку к компании.'
      );
    }
    await this.bitrix24.addDealComment(
      dealId,
      this.buildSystemComment('Создана сделка из счета', { number: Number_Order, date: Date_Order, total: invoiceTotal, lines: orderLines })
    );

    return { success: true, action: 'created', dealId, message: 'Новая сделка создана' };
  }

  // Обработка документа "Отгрузка"
  async processShipment(document) {
    // Берем оба варианта completed/Completed без дефолта true
    const { GUID_Order, shipped = [], Completed } = document;
    const isCompleted = (Completed === true) || (document.completed === true);

    const deal = await this.bitrix24.findDealByGUID(GUID_Order);
    if (!deal) return { success: false, message: 'Сделка не найдена для отгрузки' };

    const currentProducts = await this.bitrix24.getDealProducts(deal.ID);
    const stages = config.getStagesForCategoryId(deal.CATEGORY_ID);

    await this.bitrix24.updateDeal(deal.ID, {
      STAGE_ID: stages.shipment,
      [config.dealFields.originalProducts]: JSON.stringify(currentProducts)
    });

    // Получаем текущие строки "Товары из счета" и "Отгруженные товары"
    const fullDeal = await this.bitrix24.getDeal(deal.ID);
    const orderLines = fullDeal?.[config.dealFields.orderProductsStrings] || [];
    const shippedLinesExisting = fullDeal?.[config.dealFields.shippedProductsStrings] || [];

    const invoiceItems = this.parseProductStringLines(orderLines);
    const alreadyShippedItems = this.parseProductStringLines(Array.isArray(shippedLinesExisting) ? shippedLinesExisting : [shippedLinesExisting].filter(Boolean));

    // Индексация по ключу (id приоритетно, затем name+price для разделения товаров с разными ценами)
    const keyOf = (it) => {
      if (it.id != null) return `id:${it.id}`;
      const namePart = (it.name || '').toLowerCase().trim();
      const pricePart = it.price != null ? `:price:${it.price}` : '';
      return `name:${namePart}${pricePart}`;
    };
    const toNum = (v) => { if (typeof v === 'number') return v; const s = String(v ?? '0').replace(/\s+/g,'').replace(',', '.'); const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };

    // Группируем товары счета по базовому ключу (id или только name без price)
    const baseKeyOf = (it) => it.id != null ? `id:${it.id}` : `name:${(it.name||'').toLowerCase().trim()}`;
    
    // Карта списков товаров из счета по базовому ключу (для FIFO списания)
    const invoiceByBaseKey = new Map();
    for (const it of invoiceItems) {
      const baseKey = baseKeyOf(it);
      if (!invoiceByBaseKey.has(baseKey)) {
        invoiceByBaseKey.set(baseKey, []);
      }
      invoiceByBaseKey.get(baseKey).push({
        qty: toNum(it.quantity),
        price: toNum(it.price),
        id: it.id,
        name: it.name,
        originalItem: it
      });
    }

    // Суммарно уже отгружено по полному ключу (name+price)
    const shippedSumMap = new Map();
    for (const it of alreadyShippedItems) {
      shippedSumMap.set(keyOf(it), (shippedSumMap.get(keyOf(it)) || 0) + toNum(it.quantity));
    }

    // Ограниченная текущая партия с FIFO списанием
    const limited = [];
    for (const s of shipped) {
      const hasExplicitPrice = (s.summa_final != null || s.price != null || s.PRICE != null);
      const explicitPrice = toNum(s.summa_final ?? s.price ?? s.PRICE ?? s.summa);
      
      const baseItem = {
        id: s.id ?? s.ID ?? s.ProductId ?? s.PRODUCT_ID,
        name: s.name ?? s.PRODUCT_NAME,
        requestedQty: toNum(s.quantity ?? s.QUANTITY)
      };
      
      const baseKey = baseKeyOf(baseItem);
      const invoiceList = invoiceByBaseKey.get(baseKey);
      
      if (!invoiceList || invoiceList.length === 0) continue;
      
      let remainingToShip = baseItem.requestedQty;
      
      // Если в отгрузке указана конкретная цена - ищем точное совпадение
      if (hasExplicitPrice && explicitPrice > 0) {
        const item = {
          ...baseItem,
          price: explicitPrice,
          skidka: toNum(s.skidka),
          summa_final: explicitPrice,
          summa: toNum(s.summa ?? s.price ?? s.PRICE)
        };
        const key = keyOf(item);
        const invCard = invoiceList.find(inv => Math.abs(inv.price - explicitPrice) < 0.01);
        
        if (invCard) {
          const allowed = Math.max(0, invCard.qty - (shippedSumMap.get(key) || 0));
          if (allowed > 0) {
            const finalQty = Math.min(allowed, remainingToShip);
            if (finalQty > 0) {
              limited.push({ ...item, quantity: finalQty, price: explicitPrice });
              shippedSumMap.set(key, (shippedSumMap.get(key) || 0) + finalQty);
              remainingToShip -= finalQty;
            }
          }
        }
      } else {
        // Если цены нет - списываем FIFO по порядку из счета
        for (const invCard of invoiceList) {
          if (remainingToShip <= 0) break;
          
          const item = {
            ...baseItem,
            price: invCard.price
          };
          const key = keyOf(item);
          const allowed = Math.max(0, invCard.qty - (shippedSumMap.get(key) || 0));
          
          if (allowed > 0) {
            const finalQty = Math.min(allowed, remainingToShip);
            if (finalQty > 0) {
              limited.push({
                id: baseItem.id,
                name: baseItem.name,
                quantity: finalQty,
                price: invCard.price,
                skidka: 0,
                summa_final: invCard.price,
                summa: invCard.price
              });
              shippedSumMap.set(key, (shippedSumMap.get(key) || 0) + finalQty);
              remainingToShip -= finalQty;
            }
          }
        }
      }
    }

    // Агрегируем НАКОПИТЕЛЬНО: уже отгружено + текущая партия => product rows
    const mergedMap = new Map();
    const addToMerged = (arr, preferPrice = false) => {
      for (const it of arr) {
        const key = keyOf(it);
        const prev = mergedMap.get(key) || { id: it.id, name: it.name, quantity: 0, price: 0 };
        const quantity = toNum(prev.quantity) + toNum(it.quantity);
        const price = preferPrice && toNum(it.price) > 0 ? toNum(it.price) : (toNum(prev.price) > 0 ? prev.price : toNum(it.price));
        mergedMap.set(key, { id: it.id, name: it.name, quantity, price });
      }
    };

    addToMerged(alreadyShippedItems, false);
    addToMerged(limited, true); // цена из текущей партии имеет приоритет

    const accumulated = Array.from(mergedMap.values());

    // Записываем накопительные product rows
    await this.bitrix24.addProductsToDeal(deal.ID, accumulated);

    // Формируем строки и сумму текущей партии
    const { lines: shippedBatchLines, total: shippedBatchTotal } = this.buildProductStringsAndSum(limited, { includeId: true });

    // Накапливаем сумму отгруженных (нормализуем текущее значение из UF)
    const prevShippedSum = toNum(fullDeal?.[config.dealFields.shippedSum]);
    const nextShippedSum = prevShippedSum + shippedBatchTotal;
    await this.bitrix24.updateDeal(deal.ID, { [config.dealFields.shippedSum]: String(nextShippedSum) });

    await this.bitrix24.setDealMultipleStringField(
      deal.ID,
      config.dealFields.shippedProductsStrings,
      shippedBatchLines,
      { append: true }
    );

    await this.bitrix24.addDealComment(
      deal.ID,
      this.buildSystemComment('Отгрузка: product rows показывают накопительно отгруженные', { total: shippedBatchTotal, lines: shippedBatchLines })
    );

    // Если отгрузка завершена — перевести сделку в CLOSED
    if (isCompleted) {
      await this.bitrix24.updateDeal(deal.ID, { STAGE_ID: stages.closed });
      await this.bitrix24.addDealComment(
        deal.ID,
        this.buildSystemComment('Отгрузка завершена, сделка закрыта', {})
      );
    }

    const finalMessage = isCompleted
      ? 'Отгрузка обработана, product rows — накопительно; сделка закрыта'
      : 'Отгрузка обработана, product rows — накопительно';

    return { success: true, action: 'shipped', dealId: deal.ID, message: finalMessage };
  }

  // Обработка документа "ЗакрытиеСделкиДосрочно"
  async processEarlyClosing(document) {
    const { Orders } = document;
    
    if (!Orders || !Array.isArray(Orders)) {
      return {
        success: false,
        message: 'Не указаны заказы для закрытия'
      };
    }

    const results = [];

    for (const order of Orders) {
      const deal = await this.bitrix24.findDealByGUID(order.GUID_Order);
      
      if (deal) {
        const stages = config.getStagesForCategoryId(deal.CATEGORY_ID);
        await this.bitrix24.updateDeal(deal.ID, {
          STAGE_ID: stages.closed,
          COMMENTS: (deal.COMMENTS || '') + '\nЗакрыто досрочно из 1С'
        });

        // Добавляем системный комментарий в таймлайн, как при создании/отгрузке
        await this.bitrix24.addDealComment(
          deal.ID,
          this.buildSystemComment('Синхронизация с 1С: Досрочное закрытие сделки', {})
        );
        
        results.push({
          guid: order.GUID_Order,
          dealId: deal.ID,
          status: 'closed'
        });
      } else {
        results.push({
          guid: order.GUID_Order,
          status: 'not_found'
        });
      }
    }

    return {
      success: true,
      action: 'early_closing',
      processed: results,
      message: `Обработано закрытие ${results.length} сделок`
    };
  }

  // Вспомогательный метод для извлечения фамилии
  extractLastName(responsible) {
    if (!responsible) return '';
    
    // Извлекаем фамилию из строки типа "Гладков А." или "Оператор ( Сизых Алена)"
    const matches = responsible.match(/([А-Яа-я]+)/g);
    return matches ? matches[0] : responsible;
  }

  // Формирование человекочитаемых строк по товарам и суммы
  buildProductStringsAndSum(items = [], { includeId = false } = {}) {
    const toNum = (v) => {
      if (typeof v === 'number') return v;
      if (v == null) return 0;
      const s = String(v).replace(/\s+/g, '').replace(',', '.');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };
    const lines = [];
    let total = 0;
    for (const p of (items || [])) {
      const id = p.id ?? p.ProductId ?? p.PRODUCT_ID;
      const name = p.name ?? p.PRODUCT_NAME ?? 'Товар';
      const qty = toNum(p.quantity ?? p.QUANTITY);
      
      // price/PRICE — цена за единицу, summa_final — итоговая сумма строки (уже перемноженная)
      const pricePerUnit = toNum(p.price ?? p.PRICE);
      const discount = toNum(p.skidka);
      
      // Если есть summa_final — используем её, иначе считаем qty * price
      const summaFinal = toNum(p.summa_final);
      const sum = summaFinal > 0 ? summaFinal : (qty * pricePerUnit);
      total += sum;
      
      // Для отображения вычисляем цену за штуку из суммы (если summa_final есть)
      const displayPrice = summaFinal > 0 && qty > 0 ? Math.round((summaFinal / qty) * 100) / 100 : pricePerUnit;
      
      const idPart = includeId && id != null && id !== '' ? ` [id=${id}]` : '';
      const pricePart = includeId && displayPrice != null ? ` [price=${displayPrice}]` : '';
      const discountPart = discount > 0 ? ` (скидка ${discount}%)` : '';
      
      lines.push(`${name || 'Товар'}${idPart}${pricePart}${discountPart} — ${qty || 0} шт. × ${displayPrice || 0} = ${sum || 0}`);
    }
    return { lines, total };
  }

  // Парсинг строковых позиций из множественных полей
  parseProductStringLines(lines = []) {
    const arr = Array.isArray(lines) ? lines : [lines].filter(Boolean);
    const result = [];
    for (const line of arr) {
      if (!line || typeof line !== 'string') continue;
      // Пример: "Название [id=123] [price=500] (скидка 10%) — 5 шт. × 450 = 2250"
      const idMatch = line.match(/\[\s*id\s*=\s*([^\]]+)\]/i);
      const priceTagMatch = line.match(/\[\s*price\s*=\s*([^\]]+)\]/i);
      const nameMatch = line.match(/^(.*?)\s*(?:\[|—)/);
      const qtyMatch = line.match(/—\s*(\d+[\d\s,.]*)\s*шт\./);
      const priceMatch = line.match(/×\s*(\d+[\d\s,.]*)\s*=/);
      const toNum = (v) => {
        if (v == null) return 0; const s = String(v).replace(/\s+/g,'').replace(',', '.'); const n = parseFloat(s); return Number.isFinite(n) ? n : 0;
      };
      const id = idMatch ? idMatch[1].trim() : undefined;
      const name = nameMatch ? nameMatch[1].trim() : undefined;
      const quantity = toNum(qtyMatch ? qtyMatch[1] : 0);
      // Приоритет: [price=...] из тега, затем из формулы × price
      const price = toNum(priceTagMatch ? priceTagMatch[1] : (priceMatch ? priceMatch[1] : 0));
      if (!name && id == null) continue;
      result.push({ id, name, quantity, price });
    }
    return result;
  }

  buildSystemComment(title, { number, date, total, lines } = {}) {
    const parts = [`🛠 ${title || 'Обновление'}`];
    if (number != null && number !== '') parts.push(`Номер: ${number}`);
    if (date != null && date !== '') parts.push(`Дата: ${date}`);
    if (typeof total === 'number' && !isNaN(total)) parts.push(`Сумма: ${total}`);
    if (lines && Array.isArray(lines) && lines.length) {
      parts.push('Позиции:');
      parts.push(...lines.filter(l => l != null && l !== '').map(l => `• ${l}`));
    }
    return parts.join('\n');
  }

  // Формирует общий комментарий по документу 1С (используется при создании сделки)
  formatDocumentComment(document, type = 'сделка') {
    const {
      Number_Order,
      Date_Order,
      Company,
      CompanyINN,
      Client,
      ClientINN,
      Responsible,
      products = []
    } = document || {};

    const { lines, total } = this.buildProductStringsAndSum(products, { includeId: true });

    const clientPart = Client && ClientINN 
      ? `Клиент: ${Client} (ИНН: ${ClientINN})`
      : Client 
        ? `Клиент: ${Client}`
        : ClientINN 
          ? `Клиент: (ИНН: ${ClientINN})`
          : null;

    const parts = [
      `Синхронизация с 1С: ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      Number_Order ? `Номер: ${Number_Order}` : null,
      Date_Order ? `Дата: ${Date_Order}` : null,
      clientPart,
      Responsible ? `Ответственный: ${Responsible}` : null,
      typeof total === 'number' && total > 0 ? `Сумма: ${total}` : null,
      lines && lines.length ? 'Позиции:' : null,
      ...(lines || []).map(l => l ? `• ${l}` : null)
    ].filter(Boolean);

    return parts.join('\n');
  }
}

module.exports = SyncController;

