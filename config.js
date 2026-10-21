//'use strict';
const dotenv = require('dotenv');
const assert = require('assert');

const { Sequelize } = require('sequelize');

const database_config = JSON.parse(JSON.stringify(require('./config/config.json')));

dotenv.config();

const is_production = process.env.PRODUCTION === 'true';

// ADICIONADO - Usar logger customizado
const customLogger = require('./util/customLogger.js');

if (is_production) {
    database_config.development.logging = false;
} else {
    // DESABILITADO - Logs SQL só em arquivo, não no console para evitar poluição
    database_config.development.logging = false; // Apenas em arquivo via customLogger.database()
}

let sequelize = new Sequelize(database_config.development);

(async () => {
    try {
        await sequelize.authenticate();
        customLogger.success('🗄️ Database connection established successfully');
    } catch (error) {
        customLogger.error('❌ Unable to connect to the database:', error);
    }
})();

const {
    PORT,
    HOST,
    HOST_SSL,
    TOKEN,
    HTTPS,
    VERSION,
    COMPANY,
    LOGO,
    START_ALL_SESSIONS,
    FORCE_CONNECTION_USE_HERE,
    CORS_ORIGIN,
    TIME_TYPING,
    ENGINE,
    SESSION_KEEPALIVE_ENABLED,
    SESSION_KEEPALIVE_INTERVAL_MS,
    SESSION_KEEPALIVE_ONLY_CONNECTED
} = process.env;

assert(PORT, 'PORT is required, please set the PORT variable value in the .env file');
assert(TOKEN, 'TOKEN is required, please set the ENGINE variable value in the .env file');
assert(CORS_ORIGIN, 'CORS_ORIGIN is required, please set the CORS_ORIGIN variable value in the .env file');

// Validação da ENGINE
const validEngines = ['1', '2', '3'];
if (!ENGINE || !validEngines.includes(ENGINE)) {
    console.error('ENGINE inválida. Use 1 (WhatsappWebJS), 2 (WppConnect) ou 3 (Venom).');
    process.exit(1);
}

module.exports = {
    port: PORT,
    host: "",
    // Sem HOST nem HOST_SSL (o k8s não define nenhum) isto virava "undefined:3333", e o
    // keepalive, que se chama por esta URL, falhava calado a cada ciclo ("Unsupported
    // protocol undefined:") — desde 23/09/2026 nenhuma sessão caída voltou sozinha.
    // Vazio, ele cai no próprio padrão: http://127.0.0.1:PORT.
    host_ssl: HOST_SSL || (HOST ? `${HOST}:${PORT}` : ''),
    token: TOKEN,
    https: HTTPS,
    version: VERSION,
    company: COMPANY ? COMPANY : "myzap",
    logo: LOGO != "" ? LOGO : "https://upload.wikimedia.org/wikipedia/commons/f/f7/WhatsApp_logo.svg",
    ssl_key_path: "",
    ssl_cert_path: "",
    start_all_sessions: START_ALL_SESSIONS,
    useHere: FORCE_CONNECTION_USE_HERE,
    device_name: "",
    cors_origin: CORS_ORIGIN,
    time_typing: TIME_TYPING,
    engine: ENGINE,
    session_keepalive_enabled: SESSION_KEEPALIVE_ENABLED === "true",
    session_keepalive_interval_ms: parseInt(SESSION_KEEPALIVE_INTERVAL_MS, 10) || 300000,
    session_keepalive_only_connected: SESSION_KEEPALIVE_ONLY_CONNECTED !== "false",
    sequelize
}

