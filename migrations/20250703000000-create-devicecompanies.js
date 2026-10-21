'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Verificar se tabela já existe
    const tables = await queryInterface.showAllTables();
    if (tables.includes('DeviceCompanies')) {
      console.log('[MIGRATION] Tabela DeviceCompanies já existe, pulando...');
      return;
    }
    
    await queryInterface.createTable('DeviceCompanies', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      session: {
        type: Sequelize.STRING
      },
      sessionkey: {
        type: Sequelize.STRING
      },
      empresa_nome: {
        type: Sequelize.STRING
      },
      api_url: {
        type: Sequelize.STRING
      },
      mensagem_padrao: {
        type: Sequelize.TEXT
      },
      idprompt: {
        type: Sequelize.TEXT
      },
      vector_name: {
        type: Sequelize.STRING
      },
      ia_ativa: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        // fn('CURRENT_TIMESTAMP') gera "CURRENT_TIMESTAMP()" — SQL invalido no
        // sqlite (near "(": syntax error). literal emite a palavra-chave crua.
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('DeviceCompanies');
  }
};
