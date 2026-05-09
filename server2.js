const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const Redis = require('ioredis');

const app = express();
const port = 3000;

app.use(express.json()); 

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
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  release_date: { type: DataTypes.DATEONLY, allowNull: false }
}, { timestamps: false, tableName: 'movies' });

const Review = sequelize.define('Review', {
  movie_id: DataTypes.INTEGER,
  score: DataTypes.INTEGER,
  content: DataTypes.TEXT
}, { timestamps: false, tableName: 'reviews' });

Movie.hasMany(Review, { foreignKey: 'movie_id' });

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();
  const cacheKey = `movies_avg:${start_date}:${end_date}`;

  try {
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      const duration = Date.now() - startTime;
      res.set('X-Response-Time', `${duration}ms`);
      return res.json({ executionTime: `${duration}ms`, source: 'Redis', data: JSON.parse(cachedData) });
    }

    const resultMovies = await Movie.findAll({
      attributes: [
        'id', 'title', 'release_date',
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

    await redis.set(cacheKey, JSON.stringify(resultMovies), 'EX', 60);

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
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
    await Review.create({ movie_id: id, score: score || 10, content: content || 'Test' });
    res.status(201).json({ message: 'OK' });
  } catch (error) {
    console.log("!!! ОШИБКА POST:", error.message);
    res.status(500).json({ error: error.message });
  }
});

const server = app.listen(port, () => console.log(`Server running on ${port}`));
server.timeout = 300000;