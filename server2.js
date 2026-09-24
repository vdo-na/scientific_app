const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');

const app = express();
const port = 3000;

app.use(express.json()); 

// --- СЧЕТЧИКИ ДЛЯ ПРОВЕРКИ ЭФФЕКТИВНОСТИ ---
let cacheHits = 0;
let cacheMisses = 0;

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

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      // УВЕЛИЧИВАЕМ СЧЕТЧИК ПОПАДАНИЙ
      cacheHits++;

      const duration = Date.now() - startTime;
      res.set('X-Response-Time', `${duration}ms`);
      res.set('X-Cache', 'HIT');
      return res.json({ executionTime: `${duration}ms`, source: 'Redis', data: JSON.parse(cachedData) });
    }

    // УВЕЛИЧИВАЕМ СЧЕТЧИК ПРОМАХОВ
    cacheMisses++;

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

    // Сохраняем в Redis на 60 секунд (TTL)
    await redis.set(cacheKey, JSON.stringify(resultMovies), 'EX', 60);

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    res.set('X-Cache', 'MISS');
    res.json({ executionTime: `${duration}ms`, source: 'MySQL', data: resultMovies });

  } catch (error) {
    console.log("!!! ОШИБКА GET:", error.name, error.message); 
    res.status(500).json({ error: error.message });
  }
});

app.post('/movies/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const { score, content } = req.body;
    // Просто записываем в БД. В эксперименте №2 (TTL) инвалидация (удаление) кеша НЕ проводится.
    await Review.create({ movie_id: id, score: score || 10, content: content || 'Test' });
    res.status(201).json({ message: 'OK' });
  } catch (error) {
    console.log("!!! ОШИБКА POST:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- АВТОМАТИЧЕСКИЙ ВЫВОД СТАТИСТИКИ КАЖДЫЕ 10 СЕКУНД ---
setInterval(() => {
  const total = cacheHits + cacheMisses;
  const hitRatio = total > 0 ? ((cacheHits / total) * 100).toFixed(2) : 0;
  console.log(`\n=== ТЕКУЩАЯ ЭФФЕКТИВНОСТЬ КЭША (TTL) ===`);
  console.log(`Запросов всего: ${total}`);
  console.log(`Попаданий (HIT): ${cacheHits}`);
  console.log(`Промахов (MISS): ${cacheMisses}`);
  console.log(`Hit Ratio: ${hitRatio}%`);
  console.log(`========================================\n`);
}, 10000);

const pidusage = require('pidusage');

let backendCpuPeak = 0;
let backendRamPeak = 0;

// Замеряем ресурсы каждую секунду
setInterval(async () => {
  try {
    const stats = await pidusage(process.pid);
    
    // Обновляем пиковые значения, если текущие выше
    if (stats.cpu > backendCpuPeak) backendCpuPeak = stats.cpu;
    
    const currentRam = stats.memory / 1024 / 1024; // перевод в Мб
    if (currentRam > backendRamPeak) backendRamPeak = currentRam;
  } catch (err) {
    console.error(err);
  }
}, 1000);

// Выводим финальные пики при остановке теста (или по интервалу)
setInterval(() => {
  console.log(`\n=== МОНИТОРИНГ БЭКЕНДА (ПИКОВЫЕ ЗНАЧЕНИЯ) ===`);
  console.log(`Пиковый CPU: ${backendCpuPeak.toFixed(2)}%`);
  console.log(`Пиковая ОЗУ: ${backendRamPeak.toFixed(2)} Мб`);
  console.log(`============================================\n`);
}, 10000); // выводит статистику каждые 10 секунд

const server = app.listen(port, () => console.log(`Сервер 2 (TTL) запущен на порту ${port}`));
server.timeout = 300000;