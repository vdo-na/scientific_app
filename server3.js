const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');

const app = express();
const redis = new Redis(); // Подключение к Redis (по умолчанию localhost:6379)
const port = 3000;

// Middleware для обработки JSON в POST/PUT запросах
app.use(express.json());

// 1. Подключение к БД MySQL
const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false, // Отключаем логи для чистоты эксперимента
});

// 2. Определение моделей
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

// Установка связей для JOIN
Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

// --- ЭНДПОИНТ 1: ПОЛУЧЕНИЕ ТОП-100 ФИЛЬМОВ (ЧТЕНИЕ С КЭШЕМ) ---
app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  
  // Ключ кэша зависит от диапазона дат
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
    // Проверка кэша в Redis
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      const duration = Date.now() - startTime;
      res.set('X-Response-Time', `${duration}ms`);
      res.set('X-Cache', 'HIT');
      console.log(`[CACHE HIT] Отдано из Redis за ${duration}ms`);
      return res.json({
        executionTime: `${duration}ms`,
        source: 'Redis (Cache)',
        data: JSON.parse(cachedData)
      });
    }

    // Если кэша нет - выполняем ТЯЖЕЛЫЙ ЗАПРОС (JOIN + AVG + GROUP BY)
    const resultMovies = await Movie.findAll({
      attributes: [
        'id', 'title', 'release_date',
        [sequelize.fn('AVG', sequelize.col('Reviews.score')), 'avg_score']
      ],
      include: [{
        model: Review,
        attributes: [] // Нам нужны только данные для расчета AVG
      }],
      where: {
        release_date: { [Op.between]: [start_date || '2020-01-01', end_date || '2025-12-31'] }
      },
      group: ['Movie.id'],
      order: [[sequelize.literal('avg_score'), 'DESC']],
      limit: 100,
      subQuery: false
    });

    // Сохраняем результат в Redis на 60 секунд
    await redis.set(cacheKey, JSON.stringify(resultMovies), 'EX', 60);

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    res.set('X-Cache', 'MISS');
    console.log(`[DB MISS] Тяжелый запрос в MySQL за ${duration}ms`);
    
    res.json({
      executionTime: `${duration}ms`,
      source: 'MySQL (Database)',
      data: resultMovies
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- ЭНДПОИНТ 2: ДОБАВЛЕНИЕ ОТЗЫВА (ЗАПИСЬ С ИНВАЛИДАЦИЕЙ) ---
app.post('/movies/:id/reviews', async (req, res) => {
  const { id } = req.params;
  const { score, content } = req.body;

  try {
    // 1. Добавляем новый отзыв в БД (это изменит AVG score фильма)
    await Review.create({
      movie_id: id,
      score: score || 10,
      content: content || 'Experimental review'
    });

    // 2. ИНВАЛИДАЦИЯ КЭША
    // Удаляем все ключи списков фильмов, так как средние рейтинги могли измениться
    const keys = await redis.keys('movies_avg:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }

    console.log(`[INVALIDATION] Добавлен отзыв к фильму ${id}. Кэш списков очищен.`);
    res.status(201).json({ message: 'Отзыв добавлен, кэш инвалидирован' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Сервер запущен: http://localhost:${port}`);
});