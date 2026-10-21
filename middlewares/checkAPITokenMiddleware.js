
require('dotenv').config();

const checkAPITokenMiddleware = async (req, res, next) => {

	let apitoken = req?.headers['apitoken']

	// BUG historico: sem os "return", o next() rodava MESMO com token ausente
	// ou invalido — o handler executava e so a resposta era suprimida pelo
	// patch de res.send do index.js. Era um bypass de autorizacao.
	if (!apitoken) {
		return res.status(400).json({ error: 'NOT AUTHORIZED, please provide an API TOKEN in the headers.' });
	}

	if (apitoken != process.env.TOKEN) {
		return res.status(403).json({ error: "UNAUTHORIZED, API TOKEN is not valid." });
	}

	return next()

}

exports.checkAPITokenMiddleware = checkAPITokenMiddleware
