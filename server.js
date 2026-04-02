const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');

const app = express();
const port = 3000;

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
});

const Movie = sequelize.define('Movie', {
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  release_date: { type: DataTypes.DATEONLY, allowNull: false },
  rating: DataTypes.FLOAT
}, {
  timestamps: false,
  tableName: 'movies' 
});

const Review = sequelize.define('Review', {
  movie_id: DataTypes.INTEGER,
  content: DataTypes.TEXT,
  score: DataTypes.INTEGER
}, {
  timestamps: false,
  tableName: 'reviews'
});

Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();

  try {
    const resultMovies = await Movie.findAll({
      attributes: [
        'id',
        'title',
        'release_date',
        [sequelize.fn('AVG', sequelize.col('Reviews.score')), 'average_score']
      ],
      include: [{
        model: Review,
        attributes: [] 
      }],
      where: {
        release_date: { 
          [Op.between]: [start_date || '2020-01-01', end_date || '2025-12-31'] 
        }
      },
      group: ['Movie.id'], 
      order: [[sequelize.literal('average_score'), 'DESC']],
      limit: 100,
      subQuery: false
    });

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    console.log(`Запрос обработан за ${duration}ms. Найдено записей: ${resultMovies.length}`);
    
    res.json({
      executionTime: `${duration}ms`,
      count: resultMovies.length,
      data: resultMovies
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});