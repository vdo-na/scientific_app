const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');

const app = express();
const redis = new Redis(); 
const port = 3000;

app.use(express.json());

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false, // Отключаем логи для чистоты эксперимента
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

// Установка связей для JOIN
Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
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
        release_date: { [Op.between]: [start_date || '2020-01-01', end_date || '2025-12-31'] }
      },
      group: ['Movie.id'],
      order: [[sequelize.literal('avg_score'), 'DESC']],
      limit: 100,
      subQuery: false
    });

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

app.post('/movies/:id/reviews', async (req, res) => {
  const { id } = req.params;
  const { score, content } = req.body;

  try {
    await Review.create({
      movie_id: id,
      score: score || 10,
      content: content || 'Experimental review'
    });

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