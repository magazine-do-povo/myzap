'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('DeviceCompanies');
    
    // 1. Adiciona coluna mensagem_padrao se não existir
    if (!tableInfo.mensagem_padrao) {
      await queryInterface.addColumn('DeviceCompanies', 'mensagem_padrao', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }

    // 2. Cria índice composto (ignorar se já existir)
    try {
      await queryInterface.addIndex('DeviceCompanies', ['session', 'sessionkey']);
    } catch (e) {
      console.warn('[MIGRATION] Índice já existe');
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      await queryInterface.removeIndex('DeviceCompanies', ['session', 'sessionkey']);
    } catch (e) {}
    await queryInterface.removeColumn('DeviceCompanies', 'mensagem_padrao');
  },
};
