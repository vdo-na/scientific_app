const { Sequelize, DataTypes } = require('sequelize');
const { faker } = require('@faker-js/faker');

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
});

const Movie = sequelize.define('Movie', {
  title: DataTypes.STRING,
  description: DataTypes.TEXT('long'), 
  release_date: DataTypes.DATEONLY,
  rating: DataTypes.FLOAT
}, { timestamps: false, tableName: 'movies' });

const Review = sequelize.define('Review', {
  movie_id: DataTypes.INTEGER,
  content: DataTypes.TEXT('long'), 
  score: DataTypes.INTEGER
}, { timestamps: false, tableName: 'reviews' });

async function seedDatabase() {
  try {
    await sequelize.sync({ force: true });
    console.log('--- Начинаю глубокое заполнение базы (> 600 Мб)... ---');

    const totalMovies = 100000;
    const chunkSize = 1000;

    for (let i = 0; i < totalMovies; i += chunkSize) {
      const moviesData = [];
      for (let j = 0; j < chunkSize; j++) {
        moviesData.push({
          title: faker.commerce.productName(),
          // УВЕЛИЧИЛИ: теперь 20 параграфов текста (было 5)
          description: faker.lorem.paragraphs(20), 
          release_date: faker.date.between({ from: '2020-01-01', to: '2025-12-31' }),
          rating: parseFloat((Math.random() * 10).toFixed(1))
        });
      }

      const createdMovies = await Movie.bulkCreate(moviesData);

      const reviewsData = [];
      createdMovies.forEach(movie => {
        // УВЕЛИЧИЛИ: теперь от 15 до 20 отзывов на каждый фильм
        const reviewsCount = Math.floor(Math.random() * 6) + 15; 
        for (let k = 0; k < reviewsCount; k++) {
          reviewsData.push({
            movie_id: movie.id,
            // УВЕЛИЧИЛИ: каждый отзыв теперь длиннее
            content: faker.lorem.sentences(10),
            score: Math.floor(Math.random() * 10) + 1
          });
        }
      });

      await Review.bulkCreate(reviewsData);
      console.log(`Прогресс: ${i + chunkSize} / ${totalMovies} фильмов загружено...`);
    }

    console.log('--- Готово! Теперь база должна весить около 700-900 Мб. ---');
    process.exit();
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

seedDatabase();