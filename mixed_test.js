const autocannon = require('autocannon');

function getRandomDateRange() {
  const year = 2025;
  const monthStr = '03'; 
  const startDay = Math.floor(Math.random() * 10) + 1;
  const endDay = Math.floor(Math.random() * 11) + 20;
  
  return {
    start: `${year}-${monthStr}-${String(startDay).padStart(2, '0')}`,
    end: `${year}-${monthStr}-${String(endDay).padStart(2, '0')}`
  };
}

async function runMixedTest() {
  console.log('Запуск нагрузки');

  const instance = autocannon({
    url: 'http://localhost:3000',
    connections: 10,
    duration: 120,
    timeout: 120000,
    requests: [
      {
        method: 'GET',
        setupRequest: (request) => {
          const dates = getRandomDateRange();
          request.path = `/movies?start_date=${dates.start}&end_date=${dates.end}`;
          return request;
        },
        weight: 9999
      },
      {
        method: 'POST',
        setupRequest: (request) => {
          const randomMovieId = Math.floor(Math.random() * 100000) + 1;
          request.path = `/movies/${randomMovieId}/reviews`;
          request.body = JSON.stringify({ score: 10, content: 'Ultra rare update' });
          request.headers = { 'Content-Type': 'application/json' };
          return request;
        },
        weight: 1
      }
    ]
  });

  autocannon.track(instance, { renderProgressBar: true });

  const result = await instance;
  console.log('\n--- ИТОГИ (0.1% ЗАПИСИ) ---');
  console.log(`Avg Latency: ${result.latency.average} ms`);
  console.log(`Avg RPS: ${result.requests.average}`);
}

runMixedTest();