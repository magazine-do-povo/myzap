/**
 * Usuário DONO das sessões (Devices.user_id é NOT NULL).
 *
 * Historicamente as engines faziam `User.findOne({ email: process.env.EMAIL })`
 * e confiavam que a linha existia no banco — ela vinha embutida numa semente
 * mantida à mão. Num banco recém-criado (semente gerada pelas migrations, ou
 * reset) o lookup voltava null, o upsert do device ia sem user_id e TODO
 * /start morria em SQLITE_CONSTRAINT antes de abrir o navegador — "o QR
 * nunca aparecia". Agora o usuário do sistema é criado sob demanda.
 *
 * A criação é por SQL direto (INSERT OR IGNORE) de propósito: o model User
 * não mapeia created_at (NOT NULL na tabela), então um findOrCreate do
 * Sequelize descarta o campo e estoura a constraint do mesmo jeito.
 */

const UserModel = require('../../../Models/user.js');
const config = require('../../../config.js');
const customLogger = require('../../../util/customLogger.js');

const User = UserModel(config.sequelize);

let cachedUser = null;

async function getOrCreateSystemUser() {
    if (cachedUser) return cachedUser;

    const email = String(process.env.EMAIL || 'admin@local.myzap').trim();

    let user = await User.findOne({ where: { email } });
    if (!user) {
        // created_at E updated_at sao NOT NULL na tabela; o OR IGNORE engole
        // violacao de constraint em silencio — por isso TODAS as colunas
        // obrigatorias vao explicitas aqui.
        await config.sequelize.query(
            'INSERT OR IGNORE INTO `Users` (`first_name`, `last_name`, `email`, `created_at`, `updated_at`) '
            + "VALUES ('Sistema', 'MyZap', :email, datetime('now'), datetime('now'))",
            { replacements: { email } }
        );
        user = await User.findOne({ where: { email } });
        if (user) {
            customLogger.info(`👤 Usuário do sistema criado automaticamente (${email})`);
        }
    }

    if (!user) {
        throw new Error(`Não foi possível criar o usuário do sistema (${email}).`);
    }

    cachedUser = user;
    return user;
}

module.exports = { getOrCreateSystemUser };
