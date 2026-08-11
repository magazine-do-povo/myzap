#!/usr/bin/env node

/**
 * Cria o usuário do sistema, sem o qual NENHUMA sessão nasce.
 *
 * Os três engines vinculam o device ao usuário achado por
 * `User.findOne({ where: { email: process.env.EMAIL } })`
 * (`engines/WppConnect.js:77`, `Venom.js:30`, `WhatsappWebJS.js:76`), e
 * `Devices.user_id` é NOT NULL. Sem esse usuário o `/start` responde `STARTING`
 * com sucesso e a sessão morre em silêncio:
 *
 *   SQLITE_CONSTRAINT: NOT NULL constraint failed: Devices.user_id
 *
 * O MyZap não tem rota de cadastro (só `/api/auth/login`) — na VPS do upstream
 * alguém inseriu o usuário à mão. Numa instalação nova isso não existe, então o
 * entrypoint roda este seed a cada boot; ele é idempotente.
 *
 * ⚠️ INSERT por SQL, e não `User.create()`: o `config/config.json` do projeto
 * define `timestamps: false`, então o Sequelize não preenche `created_at`/
 * `updated_at` — mas a tabela os exige NOT NULL. Pelo model dá
 * `NOT NULL constraint failed: Users.created_at`, que o Sequelize ainda por cima
 * embrulha como SequelizeUniqueConstraintError e manda para o caminho errado.
 *
 * Senha = SHA-1 do TOKEN do servidor, porque é assim que o login funciona lá:
 * `AuthController.js` compara `sha1(senha)` com a coluna e TAMBÉM aceita o
 * próprio TOKEN como senha. Assim o painel abre com EMAIL + TOKEN, sem inventar
 * uma segunda credencial para alguém perder.
 */
const sha1 = require('sha1');
const { sequelize } = require('../config.js');

(async () => {
    const email = (process.env.EMAIL || '').trim();
    const token = (process.env.TOKEN || '').trim();

    if (email === '') {
        console.log('[seed] EMAIL não definida — nada a fazer (e nenhuma sessão vai nascer).');
        process.exit(0);
    }

    try {
        const [existentes] = await sequelize.query(
            'SELECT id FROM Users WHERE email = $email',
            { bind: { email } }
        );

        if (existentes.length > 0) {
            console.log(`[seed] usuário do sistema já existe (${email}, id ${existentes[0].id}).`);
            process.exit(0);
        }

        await sequelize.query(
            `INSERT INTO Users (first_name, last_name, email, password, created_at, updated_at)
             VALUES ('Sistema', 'MyZap', $email, $senha, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            { bind: { email, senha: token !== '' ? sha1(token) : null } }
        );

        console.log(`[seed] usuário do sistema criado (${email}); senha do painel = TOKEN do servidor.`);
        process.exit(0);
    } catch (erro) {
        // Não derruba o boot: o servidor sobe e responde /health, e o erro fica
        // visível para quem for criar a sessão.
        console.error('[seed] falhou:', erro?.parent?.message || erro?.message || erro);
        process.exit(0);
    }
})();
