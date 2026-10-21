module.exports = {
    up: async (queryInterface, Sequelize) => {
      const tables = await queryInterface.showAllTables();
      if (tables.includes('TokenUsages')) {
        console.log('[MIGRATION] Tabela TokenUsages já existe, pulando...');
        return;
      }
      return queryInterface.createTable('TokenUsages', {
        id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        session: Sequelize.STRING,
        sessionkey: Sequelize.STRING,
        mesano: Sequelize.STRING,
        tokens_consumed: Sequelize.INTEGER,
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
      });
    },
    down: (queryInterface) => {
      return queryInterface.dropTable('TokenUsages');
    }
  };
  