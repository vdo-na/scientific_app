const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');

const app = express();
const redis = new Redis(); // Подключение к Redis
const port = 3000;

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
});

// Модели и связи
const Movie = sequelize.define('Movie', {
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  release_date: { type: DataTypes.DATEONLY, allowNull: false },
  rating: DataTypes.FLOAT
}, { timestamps: false, tableName: 'movies' });

const Review = sequelize.define('Review', {
  movie_id: DataTypes.INTEGER,
  content: DataTypes.TEXT,
  score: DataTypes.INTEGER
}, { timestamps: false, tableName: 'reviews' });

Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  
  // Уникальный ключ кэша для комбинации дат
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
    // 1. Пытаемся получить данные из Redis
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      const duration = Date.now() - startTime;
      res.set('X-Response-Time', `${duration}ms`);
      res.set('X-Cache', 'HIT'); // Флаг: Данные из кэша
      console.log(`[REDIS HIT] Запрос обработан за ${duration}ms`);
      
      return res.json({
        executionTime: `${duration}ms`,
        source: 'Redis (Cache)',
        data: JSON.parse(cachedData)
      });
    }

    // 2. Если в кэше пусто - идем в тяжелую БД (MySQL)
    const resultMovies = await Movie.findAll({
      attributes: [
        'id', 'title', 'release_date',
        [sequelize.fn('AVG', sequelize.col('Reviews.score')), 'avg_score']
      ],
      include: [{ model: Review, attributes: [] }],
      where: {
        release_date: { [Op.between]: [start_date || '2020-01-01', end_date || '2025-12-31'] }
      },
      group: ['Movie.id'],
      order: [[sequelize.literal('avg_score'), 'DESC']],
      limit: 100,
      subQuery: false
    });

    // 3. Сохраняем результат в Redis на 60 секунд (TTL)
    await redis.set(cacheKey, JSON.stringify(resultMovies), 'EX', 60);

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    res.set('X-Cache', 'MISS'); // Флаг: Данных не было в кэше
    console.log(`[DB MISS] Тяжелый запрос в БД: ${duration}ms`);
    
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

app.listen(port, () => console.log(`Server started on http://localhost:${port}`));