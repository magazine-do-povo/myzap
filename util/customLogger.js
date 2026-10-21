const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

// Criar pasta de logs se não existir. Relativo ao CWD (e não ao código): o CWD
// é o diretório de DADOS da instalação — com código e dados separados (v3),
// os logs sobrevivem à troca de versão. No layout antigo (CWD = pasta do
// código) o caminho resolve para o mesmo lugar de sempre.
const logsDir = process.env.LOGS_DIR
    ? path.resolve(process.env.LOGS_DIR)
    : path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// FUNÇÃO - Obter pasta do dia atual
function getTodayLogsDir() {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const todayDir = path.join(logsDir, today);
    
    // Criar pasta do dia se não existir
    if (!fs.existsSync(todayDir)) {
        fs.mkdirSync(todayDir, { recursive: true });
    }
    
    return todayDir;
}

// CONFIGURAÇÃO - Tipos de log e suas cores
const LOG_TYPES = {
    INFO: { color: chalk.blue, file: 'app.log' },
    SUCCESS: { color: chalk.green, file: 'app.log' },
    WARNING: { color: chalk.yellow, file: 'app.log' },
    ERROR: { color: chalk.red, file: 'error.log' },
    DEBUG: { color: chalk.gray, file: 'debug.log' },
    DATABASE: { color: chalk.cyan, file: 'database.log' },
    WHATSAPP: { color: chalk.magenta, file: 'whatsapp.log' }
};

class CustomLogger {
    constructor() {
        this.showDatabase = process.env.DEBUG_SQL === 'true';
        this.logLevel = process.env.LOG_LEVEL || 'INFO'; // DEBUG, INFO, WARNING, ERROR
        
        // Limpar logs antigos na inicialização (manter 7 dias)
        this.cleanOldLogs(7);
    }

    // MÉTODO PRINCIPAL - Log com tipo
    log(type, message, data = null) {
        const timestamp = new Date().toISOString();
        const logConfig = LOG_TYPES[type] || LOG_TYPES.INFO;
        
        // Formatar mensagem
        let logMessage = `[${timestamp}] [${type}] ${message}`;
        if (data) {
            logMessage += ` | Data: ${JSON.stringify(data)}`;
        }

        // ESCREVER NO ARQUIVO
        this.writeToFile(logConfig.file, logMessage);

        // MOSTRAR NO CONSOLE com base nas regras
        if (this.shouldShowInConsole(type)) {
            const coloredMessage = logConfig.color(`[${type}] ${message}`);
            console.log(coloredMessage);
            
            if (data && type === 'ERROR') {
                console.log(chalk.red('Data:'), data);
            }
        }
    }

    // REGRAS - Quando mostrar no console
    shouldShowInConsole(type) {
        // Sempre mostrar erros
        if (type === 'ERROR') return true;
        
        // Mostrar database apenas se DEBUG_SQL estiver ativo
        if (type === 'DATABASE') return this.showDatabase;
        
        // Outras regras baseadas no LOG_LEVEL
        const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
        const currentLevelIndex = levels.indexOf(this.logLevel);
        const messageLevelIndex = levels.indexOf(type);
        
        return messageLevelIndex >= currentLevelIndex;
    }

    // ESCREVER ARQUIVO - Agora salva na pasta do dia
    writeToFile(filename, message) {
        try {
            const todayDir = getTodayLogsDir();
            const filePath = path.join(todayDir, filename);
            fs.appendFileSync(filePath, message + '\n');
        } catch (error) {
            console.error('Erro ao escrever log:', error);
        }
    }

    // MÉTODOS CONVENIENTES
    info(message, data) { this.log('INFO', message, data); }
    success(message, data) { this.log('SUCCESS', message, data); }
    warning(message, data) { this.log('WARNING', message, data); }
    error(message, data) { this.log('ERROR', message, data); }
    debug(message, data) { this.log('DEBUG', message, data); }
    database(query, data) { this.log('DATABASE', query, data); }
    whatsapp(message, data) { this.log('WHATSAPP', message, data); }

    // MÉTODO ESPECÍFICO - Log do Sequelize
    sequelizeLogger(query, options) {
        const timestamp = new Date().toISOString();
        
        // Identificar tipo de query
        let queryType = 'SELECT';
        if (query.includes('INSERT')) queryType = 'INSERT';
        if (query.includes('UPDATE')) queryType = 'UPDATE';
        if (query.includes('DELETE')) queryType = 'DELETE';
        if (query.includes('CREATE')) queryType = 'CREATE';
        if (query.includes('DROP')) queryType = 'DROP';

        // Log completo no arquivo - Agora salva na pasta do dia
        const todayDir = getTodayLogsDir();
        this.writeToFile('database.log', `[${timestamp}] [${queryType}] ${query}`);

        // Console apenas se necessário
        if (this.showDatabase) {
            console.log(chalk.cyan(`[DB ${queryType}]`), query.substring(0, 100) + '...');
        }

        // Sempre mostrar erros de banco
        if (options?.type === 'ERROR') {
            console.log(chalk.red(`[DB ERROR]`), query);
        }
    }

    // MÉTODO - Limpar logs antigos (manter apenas X dias)
    cleanOldLogs(daysToKeep = 7) {
        try {
            const items = fs.readdirSync(logsDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            
            items.forEach(item => {
                const itemPath = path.join(logsDir, item);
                const stat = fs.statSync(itemPath);
                
                // Se for uma pasta de data (formato YYYY-MM-DD)
                if (stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(item)) {
                    const itemDate = new Date(item);
                    if (itemDate < cutoffDate) {
                        fs.rmSync(itemPath, { recursive: true, force: true });
                        console.log(chalk.yellow(`🗑️ Logs antigos removidos: ${item}`));
                    }
                }
            });
        } catch (error) {
            this.error('Erro ao limpar logs antigos:', error);
        }
    }
}

// EXPORTAR INSTÂNCIA SINGLETON
module.exports = new CustomLogger();
