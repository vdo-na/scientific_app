const { Sequelize, DataTypes } = require('sequelize');
const { faker } = require('@faker-js/faker'); 

const sequelize = new Sequelize('mydb', 'root', 'password', {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
  // ЯВНО УКАЗЫВАЕМ КОДИРОВКУ ДЛЯ СОЕДИНЕНИЯ
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci'
  }
});

const movie = sequelize.define('movie', {
  title: DataTypes.STRING,
  description: DataTypes.TEXT,
  release_date: { type: DataTypes.DATEONLY, allowNull: false },
  rating: DataTypes.FLOAT
}, {
  timestamps: false,
});

async function seedDatabase() {
  try {
    await sequelize.sync({ force: true });
    console.log('--- Таблица создана. Начинаю генерацию данных (Реальный английский)... ---');

    const totalRecords = 100000;
    const chunkSize = 5000; 
    
    for (let i = 0; i < totalRecords; i += chunkSize) {
      const movies = [];
      for (let j = 0; j < chunkSize; j++) {
        movies.push({
          title: faker.commerce.productName(), 
          description: faker.company.catchPhrase() + " " + faker.commerce.productDescription(), 
          release_date: faker.date.between({ from: '2020-01-01', to: '2025-12-31' }),
          rating: parseFloat((Math.random() * 10).toFixed(1))
        });
      }
      await movie.bulkCreate(movies);
      console.log(`Загружено: ${i + chunkSize} / ${totalRecords}`);
    }

    console.log(`--- Готово! Теперь в БД реальный английский без знаков вопроса. ---`);
    process.exit();
  } catch (error) {
    console.error('Ошибка:', error);
    process.exit(1);
  }
}

seedDatabase();