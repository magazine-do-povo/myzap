/**
 * Primeiro contato do dia: o "oi" do cliente tem de receber a mensagem padrão, não a IA.
 *
 * Capucho (24/09/2026): o EventsController grava a fala do cliente ANTES dos guards, e o
 * jaInteragiuHoje contava tudo — a própria mensagem virava "interação anterior", o guard
 * primeiro_contato nunca bloqueava texto e a IA respondia ao "oi". Roda o chatHistory REAL
 * contra um SQLite em memória.
 *
 * Uso: node test/primeiro-contato.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');
const { Sequelize } = require('sequelize');

const raiz = path.join(__dirname, '..');
const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
const arquivo = require.resolve(path.join(raiz, 'config.js'));
require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { sequelize } };

const ChatHistoryHelper = require(path.join(raiz, 'controllers/helper/events/chatHistory.js'));
const k = { session: 's', sessionkey: 'CapuchoLanches', numero: '152574535688336@lid' };

let falhas = 0;
const caso = async (nome, fn) => {
  try { await fn(); console.log(`ok   ${nome}`); } catch (e) { falhas++; console.log(`FALHOU ${nome}: ${e.message}`); }
};

(async () => {
  await sequelize.getQueryInterface().createTable('chat_history', {
    id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
    session: Sequelize.TEXT, sessionkey: Sequelize.TEXT, numero_cliente: Sequelize.TEXT,
    role: Sequelize.TEXT, msg: Sequelize.TEXT, message_type: Sequelize.STRING, created_at: Sequelize.DATE,
  });

  await caso('o "oi" gravado antes dos guards não conta como interação anterior', async () => {
    await ChatHistoryHelper.registerUserMessage({ ...k, text: 'oi' });
    assert.strictEqual(await ChatHistoryHelper.jaInteragiuHoje(k), false);
  });
  await caso('depois da mensagem padrão, a próxima mensagem já não é primeiro contato', async () => {
    await ChatHistoryHelper.registerAssistantMessage({ ...k, text: 'Olá! Acesse o cardápio', messageType: 'mensagem_padrao' });
    assert.strictEqual(await ChatHistoryHelper.jaInteragiuHoje(k), true);
  });
  await caso('atendente que falou hoje também conta', async () => {
    const outro = { ...k, numero: '999@lid' };
    await ChatHistoryHelper.registerAgentMessage({ ...outro, text: 'boa noite, já te atendo' });
    assert.strictEqual(await ChatHistoryHelper.jaInteragiuHoje(outro), true);
  });
  // Loja fechada (19/10/2026): o aviso sai no lugar da padrão, e a padrão tem de sair quando abrir
  await caso('aviso de loja fechada não conta como interação: a próxima ainda é primeiro contato', async () => {
    const fechada = { ...k, numero: '777@lid' };
    await ChatHistoryHelper.registerUserMessage({ ...fechada, text: 'oi' });
    await ChatHistoryHelper.registerAssistantMessage({ ...fechada, text: 'No momento estamos fechados', messageType: 'aviso_fechada' });
    assert.strictEqual(await ChatHistoryHelper.jaInteragiuHoje(fechada), false);
    assert.strictEqual(await ChatHistoryHelper.jaEnvieiMensagemPadraoHoje(fechada), false);
    assert.strictEqual(await ChatHistoryHelper.jaEnvieiMensagemPadraoHoje({ ...fechada, tipo: 'aviso_fechada' }), true);
  });
  await caso('mensagem do sistema sem tipo ainda conta como interação', async () => {
    const semTipo = { ...k, numero: '888@lid' };
    await sequelize.models.ChatHistory.create({ session: k.session, sessionkey: k.sessionkey, numero_cliente: semTipo.numero, role: 'assistant', msg: 'x', message_type: null, created_at: new Date() });
    assert.strictEqual(await ChatHistoryHelper.jaInteragiuHoje(semTipo), true);
  });

  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} caso(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
