const autocannon = require('autocannon');

async function runMixedTest() {
  console.log('Запуск смешанной нагрузки: 90% чтение / 10% добавление отзывов...');

  const instance = autocannon({
    url: 'http://localhost:3000',
    connections: 10,
    duration: 60, 
    timeout: 120000, 
    requests: [
      {
        method: 'GET',
        path: '/movies?start_date=2025-01-01&end_date=2025-01-31',
        weight: 9 
      },
      {
        method: 'POST',
        path: '/movies/1/reviews', 
        body: JSON.stringify({ score: 10, content: 'Great movie!' }),
        headers: { 'Content-Type': 'application/json' },
        weight: 1 
      }
    ]
  });

  autocannon.track(instance, { renderProgressBar: true });

  const result = await instance;
  console.log('\n--- РЕЗУЛЬТАТЫ ЭКСПЕРИМЕНТА №3 (ИНВАЛИДАЦИЯ) ---');
  console.log(`Среднее время ответа (Latency): ${result.latency.average} ms`);
  console.log(`Запросов в секунду (RPS): ${result.requests.average}`);
  console.log(`Всего запросов: ${result.requests.total}`);
}

runMixedTest();