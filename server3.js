const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');

const app = express();
const redis = new Redis(); 
const port = 3000;

app.use(express.json());

let cacheHits = 0;
let cacheMisses = 0;

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
  description: DataTypes.TEXT('long'),
  release_date: { type: DataTypes.DATEONLY, allowNull: false }
}, { timestamps: false, tableName: 'movies' });

const Review = sequelize.define('Review', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  movie_id: { type: DataTypes.INTEGER, allowNull: false },
  content: DataTypes.TEXT('long'),
  score: { type: DataTypes.INTEGER, allowNull: false }
}, { timestamps: false, tableName: 'reviews' });

Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

// --- ЭНДПОИНТ ЧТЕНИЯ ---
app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  
  // Формат ключа: movies_avg:YYYY-MM-DD:YYYY-MM-DD
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      cacheHits++;
      const duration = Date.now() - startTime;
      res.set('X-Response-Time', `${duration}ms`);
      res.set('X-Cache', 'HIT');
      return res.json({
        executionTime: `${duration}ms`,
        source: 'Redis (Cache)',
        data: JSON.parse(cachedData)
      });
    }

    cacheMisses++;

    const resultMovies = await Movie.findAll({
      attributes: [
        'id', 'title', 'release_date',
        [sequelize.fn('AVG', sequelize.col('Reviews.score')), 'avg_score']
      ],
      include: [{
        model: Review,
        attributes: [] 
      }],
      where: {
        release_date: { [Op.between]: [start_date || '2025-01-01', end_date || '2025-12-31'] }
      },
      group: ['Movie.id'],
      order: [[sequelize.literal('avg_score'), 'DESC']],
      limit: 100,
      subQuery: false,
      raw: true 
    });

    await redis.set(cacheKey, JSON.stringify(resultMovies), 'EX', 60);

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    res.set('X-Cache', 'MISS');
    
    res.json({
      executionTime: `${duration}ms`,
      source: 'MySQL (Database)',
      data: resultMovies
    });

  } catch (error) {
    console.error("Ошибка GET:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- ЭНДПОИНТ ЗАПИСИ (С УМНОЙ ИНВАЛИДАЦИЕЙ) ---
app.post('/movies/:id/reviews', async (req, res) => {
  const { id } = req.params;
  const { score, content } = req.body;

  try {
    // 1. Находим фильм, чтобы узнать его дату релиза
    const movie = await Movie.findByPk(id);
    if (!movie) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    const movieDate = movie.release_date;

    // 2. Создаем отзыв в БД
    await Review.create({
      movie_id: id,
      score: score || 10,
      content: content || 'Experimental review'
    });

    // 3. УМНАЯ ИНВАЛИДАЦИЯ
    // Получаем все ключи, относящиеся к средним рейтингам
    const allKeys = await redis.keys('movies_avg:*');
    const keysToDelete = [];

    for (const key of allKeys) {
      // Ключ имеет формат "movies_avg:START:END"
      // Разрезаем строку по двоеточию
      const parts = key.split(':');
      if (parts.length === 3) {
        const cacheStart = parts[1];
        const cacheEnd = parts[2];

        // Проверяем: входит ли дата релиза фильма в диапазон этого ключа?
        // Сравнение строк дат (YYYY-MM-DD) работает корректно
        if (movieDate >= cacheStart && movieDate <= cacheEnd) {
          keysToDelete.push(key);
        }
      }
    }

    // Удаляем только затронутые ключи
    if (keysToDelete.length > 0) {
      await redis.del(keysToDelete);
      console.log(`[INVALIDATION] Удалено ключей: ${keysToDelete.length} для даты ${movieDate}`);
    } else {
      console.log(`[INVALIDATION] Изменение даты ${movieDate} не затронуло существующий кеш.`);
    }

    res.status(201).json({ message: 'Отзыв добавлен, кеш выборочно очищен' });

  } catch (error) {
    console.error("Ошибка POST:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

setInterval(() => {
  const total = cacheHits + cacheMisses;
  const hitRatio = total > 0 ? ((cacheHits / total) * 100).toFixed(2) : 0;
  console.log(`\n=== ТЕКУЩАЯ ЭФФЕКТИВНОСТЬ КЭША ===`);
  console.log(`Запросов всего: ${total}`);
  console.log(`Попаданий (HIT): ${cacheHits}`);
  console.log(`Промахов (MISS): ${cacheMisses}`);
  console.log(`Hit Ratio: ${hitRatio}%`);
  console.log(`==================================\n`);
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

const server = app.listen(port, () => {
  console.log(`Сервер запущен: http://localhost:${port}`);
});
server.timeout = 300000;