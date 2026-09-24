const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');

const app = express();
const port = 3000;

app.use(express.json());

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
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
  content: DataTypes.TEXT,
  score: DataTypes.INTEGER
}, { timestamps: false, tableName: 'reviews' });

Movie.hasMany(Review, { foreignKey: 'movie_id' });
Review.belongsTo(Movie, { foreignKey: 'movie_id' });

app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;
  const startTime = Date.now();

  try {
    const resultMovies = await Movie.findAll({
      attributes: [
        'id', 'title', 'release_date',
        [sequelize.fn('AVG', sequelize.col('Reviews.score')), 'average_score']
      ],
      include: [{ model: Review, attributes: [] }],
      where: {
        release_date: { [Op.between]: [start_date || '2020-01-01', end_date || '2025-12-31'] }
      },
      group: ['Movie.id'], 
      order: [[sequelize.literal('average_score'), 'DESC']],
      limit: 100,
      subQuery: false
    });

    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
    console.log(`[DB SELECT] Запрос обработан за ${duration}ms`);
    res.json({ executionTime: `${duration}ms`, count: resultMovies.length, data: resultMovies });

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
      content: content || 'Baseline test review'
    });
    console.log(`[DB INSERT] Отзыв добавлен к фильму ${id}`);
    res.status(201).json({ message: 'Отзыв добавлен' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

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

app.listen(port, () => {
  console.log(`Сервер 1 (БЕЗ КЕША) запущен на порту ${port}`);
});