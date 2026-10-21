const DeviceModel = require('../../../Models/device.js');
const config = require('../../../config.js');
const customLogger = require('../../../util/customLogger.js'); // Logger padronizado

const Device = DeviceModel(config.sequelize);

const SessionsHelper = {
  clients: {},

  async getDevice(session, sessionkey = null) {
    const where = sessionkey ? { session, sessionkey } : { session };
    return await Device.findOne({ where });
  },

  async listDevices() {
    return await Device.findAll();
  },

  injectClient(session, clientInstance) {
    this.clients[session] = clientInstance;
  },

  getInjectedClient(session) {
    return this.clients[session];
  },

  /**
   * 🔍 Retorna todas as sessões ativas na memória com seus clients
   * Usado pelo Health Check para verificar sessões zumbi
   */
  getAllSessions() {
    const sessions = [];
    for (const [session, client] of Object.entries(this.clients)) {
      if (client) {
        sessions.push({ session, client });
      }
    }
    return sessions;
  },

  /**
   * Retorna o client de uma sessão (alias para getInjectedClient)
   */
  getClient(session) {
    return this.clients[session];
  },

  async getSessionWithClient(session) {
    const instance = await this.getDevice(session);
    if (!instance) return false;

    return {
      ...instance.dataValues,
      client: this.getInjectedClient(session)
    };
  },

  /**
   * A MEMÓRIA sai antes do banco: sem o client aqui o health check não vê a sessão, e sem a
   * linha no banco o keepalive não a religa. Antes, o banco falhando (SQLite ocupado) saltava o
   * `delete` da memória — a sessão "excluída" seguia viva, era declarada zumbi a cada minuto e o
   * keepalive mandava `/start` nela (`[START NEW] … Status: ZOMBIE`). Devolve false se o banco
   * falhou: quem excluiu precisa saber, para repetir.
   */
  async deleteSessionAndCleanup(session) {
    delete this.clients[session];
    try {
      await Device.destroy({ where: { session } });
      return true;
    } catch (err) {
      customLogger.error(`[❌ DELETE SESSION] ${session} - ${err.message}`);
      return false;
    }
  },

  /**
   * Remove cliente da memória (usado pelo health check para zombies)
   * NÃO remove do banco de dados - apenas limpa a referência em memória
   */
  removeClientFromMemory(session) {
    try {
      if (this.clients[session]) {
        delete this.clients[session];
        customLogger.info(`[MEMORY CLEANUP] ${session}: Cliente removido da memória`);
        return true;
      }
      return false;
    } catch (err) {
      customLogger.error(`[MEMORY CLEANUP ERROR] ${session}: ${err.message}`);
      return false;
    }
  },

  /** Teto por passo ao fechar: o WhatsApp Web às vezes não responde, e a exclusão não pode ficar presa nele. */
  TETO_FECHAR_MS: 10000,

  /**
   * Excluir sessão: logout no WhatsApp e DESTRUIR o client. Fechar só a aba (page.close)
   * deixava o Chrome vivo — na VPS, o navegador de uma sessão excluída em 09/10/2026 seguia de
   * pé dois dias depois, com 900 MB. O logout do whatsapp-web.js só fecha o navegador se chegar
   * ao fim (página morta derruba o logout antes), por isso o destroy vem sempre depois:
   * destroy() no whatsapp-web.js, close() no wppconnect/venom.
   */
  async fecharSessaoComLogout(data, session) {
    const client = data?.client;
    const comTeto = async (promessa) => {
      let relogio;
      try {
        return await Promise.race([
          promessa,
          new Promise((_, falha) => { relogio = setTimeout(() => falha(new Error(`sem resposta em ${this.TETO_FECHAR_MS} ms`)), this.TETO_FECHAR_MS); }),
        ]);
      } finally {
        clearTimeout(relogio);
      }
    };
    let logout = false, close = false;

    try {
      await comTeto(client?.logout());
      logout = true;
    } catch (err) {
      console.log(`[SESSION] ${session} - Erro ao fazer logout: ${err?.message}`);
    }

    try {
      if (typeof client?.destroy === 'function') await comTeto(client.destroy());
      else if (typeof client?.close === 'function') await comTeto(client.close());
      close = true;
    } catch (err) {
      console.log(`[SESSION] ${session} - Erro ao fechar o navegador: ${err?.message}`);
    }

    return { logout, close };
  },

  async atualizarTentativasStart(session, currentAttempts, lastStart = null) {
    await Device.update({
      attempts_start: currentAttempts + 1,
      last_start: lastStart || new Date()
    }, { where: { session } });
  },

  async atualizarTentativasStartSeguro(session, data) {
    try {
      const currentAttempts = data?.attempts_start || 0;
      const lastStart = data?.last_start ? new Date(data.last_start) : new Date();
      
      await Device.update({
        attempts_start: currentAttempts + 1,
        last_start: lastStart
      }, { where: { session } });
      
      return true;
    } catch (error) {
      console.error(`[ATTEMPTS UPDATE ERROR] ${session} - ${error.message}`);
      return false;
    }
  }
};

module.exports = SessionsHelper;
