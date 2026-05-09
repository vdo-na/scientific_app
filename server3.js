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

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
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

    res.status(201).json({ message: 'Отзыв добавлен, кэш инвалидирован' });

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

const server = app.listen(port, () => {
  console.log(`Сервер запущен: http://localhost:${port}`);
});
server.timeout = 300000;