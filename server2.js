const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');
const pidusage = require('pidusage');

const app = express();
const port = 3000;

app.use(express.json()); 

// ====================================================================
// ВАЖНО: ЗДЕСЬ МЕНЯЕМ TTL ДЛЯ КАЖДОГО ЭКСПЕРИМЕНТА (в секундах)
// Например: 2, 10, 30, 60, 120
// ====================================================================
const CURRENT_TTL = parseInt(process.env.CACHE_TTL, 10) || 100;

// --- СЧЕТЧИКИ ДЛЯ ПРОВЕРКИ ЭФФЕКТИВНОСТИ ---
let cacheHits = 0;
let cacheMisses = 0;

// --- СЧЕТЧИКИ АКТУАЛЬНОСТИ (КРИТЕРИЙ 1 ДЛЯ МАИ / TOPSIS) ---
let freshResponses = 0; // Актуальные ответы
let staleResponses = 0; // Устаревшие ответы
let lastDbWriteTime = 0; // Время последней записи в БД

const redis = new Redis({
  retryStrategy: (times) => Math.min(times * 50, 2000), 
});

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
  pool: {
    max: 30,         
    min: 5,
    acquire: 120000, 
    idle: 10000
  }
});

const Movie = sequelize.define('Movie', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  release_date: { type: DataTypes.DATEONLY, allowNull: false }
}, { timestamps: false, tableName: 'movies' });

const Review = sequelize.define('Review', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  movie_id: DataTypes.INTEGER,
  score: DataTypes.INTEGER,
  content: DataTypes.TEXT
}, { timestamps: false, tableName: 'reviews' });

Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

// ==========================================
// ЭНДПОИНТ ЧТЕНИЯ (GET)
// ==========================================
app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
    const rawCached = await redis.get(cacheKey);

    if (rawCached) {
      cacheHits++;

      const cachedPayload = JSON.parse(rawCached);

      // ПРОВЕРКА НА АКТУАЛЬНОСТЬ (СВЕЖЕСТЬ) ДАННЫХ
      // Если запись в БД произошла ПОСЛЕ того, как кеш был создан -> данные устарели
      if (lastDbWriteTime > cachedPayload.cachedAt) {
        staleResponses++; // Устаревший ответ
      } else {
        freshResponses++; // Актуальный ответ
      }

      const duration = Date.now() - startTime;
      res.set('X-Response-Time', `${duration}ms`);
      res.set('X-Cache', 'HIT');
      return res.json({ 
        executionTime: `${duration}ms`, 
        source: 'Redis', 
        data: cachedPayload.data 
      });
    }

    // ПРОМАХ (MISS) -> идем в БД, следовательно данные 100% актуальные
    cacheMisses++;
    freshResponses++;

    const resultMovies = await Movie.findAll({
      attributes: [
        'id',
        'title',
        'release_date',
        [sequelize.fn('AVG', sequelize.col('Reviews.score')), 'average_score']
      ],
      include: [{ model: Review, attributes: [] }],
      where: { release_date: { [Op.between]: [start_date || '2020-01-01', end_date || '2025-12-31'] } },
      group: ['Movie.id'],
      order: [[sequelize.literal('average_score'), 'DESC']],
      limit: 100,
      subQuery: false,
      raw: true, 
    });

    // Сохраняем в кеш объект с датой создания
    const payloadToCache = {
      cachedAt: Date.now(),
      data: resultMovies
    };

    await redis.set(cacheKey, JSON.stringify(payloadToCache), 'EX', CURRENT_TTL);

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    res.set('X-Cache', 'MISS');
    res.json({ executionTime: `${duration}ms`, source: 'MySQL', data: resultMovies });

  } catch (error) {
    console.log("!!! ОШИБКА GET:", error.name, error.message); 
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ЭНДПОИНТ ЗАПИСИ (POST)
// ==========================================
app.post('/movies/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const { score, content } = req.body;

    await Review.create({ movie_id: id, score: score || 10, content: content || 'Test' });

    // ФИКСИРУЕМ ВРЕМЯ ПОСЛЕДНЕЙ ЗАПИСИ В БД
    lastDbWriteTime = Date.now();

    res.status(201).json({ message: 'OK' });
  } catch (error) {
    console.log("!!! ОШИБКА POST:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// МОНИТОРИНГ И ВЫВОД РЕЗУЛЬТАТОВ ДЛЯ СТАТЬИ
// ==========================================
setInterval(() => {
  const total = cacheHits + cacheMisses;
  const hitRatio = total > 0 ? ((cacheHits / total) * 100).toFixed(2) : 0;
  
  const totalResponses = freshResponses + staleResponses;
  const freshnessRatio = totalResponses > 0 ? ((freshResponses / totalResponses) * 100).toFixed(2) : 100;

  console.log(`\n======================================================`);
  console.log(`ТЕКУЩИЕ РЕЗУЛЬТАТЫ (TTL = ${CURRENT_TTL}s):`);
  console.log(`[Критерий 1] Свежесть данных: ${freshnessRatio}% (Свежих: ${freshResponses}, Устаревших: ${staleResponses})`);
  console.log(`[Кэш] Hit Ratio: ${hitRatio}% (Хитов: ${cacheHits}, Промахов: ${cacheMisses})`);
  console.log(`======================================================\n`);
}, 10000);

let backendCpuPeak = 0;
let backendRamPeak = 0;

setInterval(async () => {
  try {
    const stats = await pidusage(process.pid);
    if (stats.cpu > backendCpuPeak) backendCpuPeak = stats.cpu;
    const currentRam = stats.memory / 1024 / 1024;
    if (currentRam > backendRamPeak) backendRamPeak = currentRam;
  } catch (err) {
    // игнорируем разовые ошибки замера
  }
}, 1000);

const server = app.listen(port, () => {
  console.log(`\n>>> Сервер запущен на порту ${port} с TTL = ${CURRENT_TTL} сек <<<`);
});
server.timeout = 300000;