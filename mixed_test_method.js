const autocannon = require('autocannon');

const testStartTime = Date.now();

async function runMixedTest() {
  console.log('>>> Запуск трехфазной волновой нагрузки (120 секунд) <<<');
  console.log('Фаза 1 (0-40с): Затишье (1% записи)');
  console.log('Фаза 2 (40-80с): ШКВАЛ ТРАНЗАКЦИЙ (25% записи)');
  console.log('Фаза 3 (80-120с): Спад активности (1% записи)\n');

  const instance = autocannon({
    url: 'http://localhost:3000',
    connections: 10,
    duration: 120,
    timeout: 120000,
    requests: [
      {
        setupRequest: (request) => {
          const elapsedSec = (Date.now() - testStartTime) / 1000;

          // ОПРЕДЕЛЯЕМ ВЕРОЯТНОСТЬ ЗАПИСИ В ЗАВИСИМОСТИ ОТ ВРЕМЕНИ
          let writeProbability = 0.01; // По умолчанию 1%
          if (elapsedSec >= 40 && elapsedSec < 80) {
            writeProbability = 0.25; // Фаза шквала: 25% всех запросов - это запись!
          }

          // Генерируем запрос
          if (Math.random() < writeProbability) {
            // ЭТО ЗАПИСЬ (POST)
            const randomMovieId = Math.floor(Math.random() * 100000) + 1;
            request.method = 'POST';
            request.path = `/movies/${randomMovieId}/reviews`;
            request.headers = { 'Content-Type': 'application/json' };
            request.body = JSON.stringify({ score: 10, content: 'Wave load review' });
          } else {
            // ЭТО ЧТЕНИЕ (GET)
            request.method = 'GET';
            request.path = '/movies?start_date=2025-03-01&end_date=2025-03-20';
            request.headers = {};
            request.body = undefined;
          }
          return request;
        }
      }
    ]
  });

  autocannon.track(instance, { renderProgressBar: true });

  const result = await instance;
  console.log('\n--- ИТОГИ ВОЛНОВОГО ТЕСТА ---');
  console.log(`Среднее время ответа (Avg Latency): ${result.latency.average} ms`);
  console.log(`Пропускная способность (Avg RPS): ${result.requests.average}`);
}

runMixedTest();