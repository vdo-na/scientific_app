const autocannon = require('autocannon');

async function runMixedTest() {
  console.log('Запуск смешанной нагрузки: 90% чтение / 10% добавление отзывов...');

  const instance = autocannon({
    url: 'http://localhost:3000',
    connections: 10,
    duration: 60, // Сделаем 60 секунд для точности
    timeout: 120000, // Таймаут как в первом тесте, т.к. база будет долго считать при MISS
    requests: [
      {
        method: 'GET',
        path: '/movies?start_date=2025-01-01&end_date=2025-01-31',
        weight: 9 // 90% запросов - чтение (будут попадать в кэш, пока его не удалят)
      },
      {
        method: 'POST',
        path: '/movies/1/reviews', // Добавляем отзыв к первому фильму
        body: JSON.stringify({ score: 10, content: 'Great movie!' }),
        headers: { 'Content-Type': 'application/json' },
        weight: 1 // 10% запросов - добавление (удаляют кэш)
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