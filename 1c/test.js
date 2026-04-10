const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Тестовые данные из example.json
const testData = {
  "Documents": [
    {
      "type": "Сделка",
      "GUID_Order": "45d60347-4f0e-11f0-815c-80b3c846805d",
      "Number_Order": "УТБТГ003161",
      "Date_Order": "2025-07-16T07:58:51Z",
      "Company": "91287a20-53d4-11e6-be3e-5254008957e2",
      "CompanyINN": "3808190277",
      "Client": "b78542c4-f277-11ef-815b-82ed8e1dbb29",
      "ClientINN": "7500014036",
      "Responsible": "Гладков А.",
      "products": [
        {
          "name": "Каска Delta Plus защитная строительная DIAMONDV, черного цвета DIAM5NO",
          "quantity": 140,
          "price": 2300
        },
        {
          "name": "Каска Delta Plus защитная BASEBALL  DIAMOND V UP из ABS лимонного цвета DIAM5UPJAF ",
          "quantity": 20,
          "price": 2300
        }
      ]
    }
  ]
};

async function testSync() {
  try {
    console.log('🧪 Запуск тестирования API синхронизации...\n');
    
    const response = await axios.post('http://localhost:3000/api/sync/1c', testData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Тест успешно выполнен!');
    console.log('📊 Результат:');
    console.log(JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка тестирования:');
    
    if (error.response) {
      console.error('Статус:', error.response.status);
      console.error('Данные:', error.response.data);
    } else if (error.request) {
      console.error('Сервер не отвечает. Убедитесь, что сервер запущен на порту 3000');
    } else {
      console.error('Ошибка:', error.message);
    }
  }
}

async function testHealth() {
  try {
    console.log('🔍 Проверка состояния сервера...\n');
    
    const response = await axios.get('http://localhost:3000/health');
    
    console.log('✅ Сервер работает!');
    console.log('📊 Состояние:');
    console.log(JSON.stringify(response.data, null, 2));
    
    return true;
  } catch (error) {
    console.error('❌ Сервер не отвечает:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Тестирование API синхронизации 1С и Битрикс24\n');
  
  // Проверяем здоровье сервера
  const serverOk = await testHealth();
  
  if (!serverOk) {
    console.log('\n💡 Для запуска тестов выполните:');
    console.log('   npm start');
    console.log('   или');
    console.log('   node server.js');
    return;
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тестируем синхронизацию
  await testSync();
}

// Запускаем тесты
runTests();
