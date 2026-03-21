const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');

const app = express();
const port = 3000;

// 1. Подключение к БД
const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false, // Отключаем логи, чтобы они не влияли на скорость
});

// 2. Определение модели (такая же, как в seed.js)
const movie = sequelize.define('movie', {
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  release_date: { type: DataTypes.DATEONLY, allowNull: false },
  rating: DataTypes.FLOAT
}, {
  timestamps: false,
  freezeTableName: true, // Запретить Sequelize изменять имя таблицы (добавлять 's' и т.д.)
  tableName: 'movies' 
});

// 3. Эндпоинт поиска (БЕЗ КЭШИРОВАНИЯ)
app.get('/movies', async (req, res) => {
  const { start_date, end_date } = req.query;

  // Засекаем время начала выполнения на сервере
  const startTime = Date.now();

  try {
    // Выполняем "тяжелый" запрос: фильтрация по дате + сортировка по рейтингу
    const movies = await movie.findAll({
      where: {
        release_date: {
          [Op.between]: [start_date || '2025-01-01', end_date || '2025-01-31']
        }
      },
      order: [['rating', 'DESC']], // Сортировка добавляет работы базе данных
      limit: 100 // Ограничим выдачу, чтобы не "повесить" браузер при передаче данных
    });

    // Засекаем время окончания
    const duration = Date.now() - startTime;

    // Отправляем результат и время выполнения в заголовке
    res.set('X-Response-Time', `${duration}ms`);
    console.log(`Запрос обработан за ${duration}ms. Найдено записей: ${movies.length}`);
    
    res.json({
      executionTime: `${duration}ms`,
      count: movies.length,
      data: movies
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
  console.log(`Для теста используй: http://localhost:${port}/movies?start_date=2025-01-01&end_date=2025-01-31`);
});