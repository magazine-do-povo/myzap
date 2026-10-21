const Sessions = require("../controllers/SessionsController");
require("dotenv").config();

const checkParams = async (req, res, next) => {
  let session = req?.body?.session;
  let sessionkey = req?.headers["sessionkey"];
  let apitoken = req?.headers["apitoken"];

  if (!sessionkey) {
    return res.status(401).json({
      result: 401,
      status: "NOT_AUTHORIZED",
      reason: "Por favor, informe um valor para SESSIONKEY",
    });
  }

  if (!session) {
    return res.status(400).json({ error: "session não informado no body." });
  }

  if (session) {
    if (session.match(/[^A-Za-z0-9\-_]/g)) {
      return res
        .status(400)
        .json({
          error:
            "Sessão com nome inválido, utilize apenas letras, números, tracos, underline, sem caracteres especiais",
        });
    }
  }

  let data = await Sessions?.getClient(session);

  if (req?.url == "/start" && req?.method === "POST") {
    if (!apitoken) {
      return res
        .status(400)
        .json({ error: "apitoken não informado no header." });
    }

    if (apitoken != process.env.TOKEN) {
      return res
        .status(403)
        .json({ error: "Unauthorized, please check the API TOKEN." });
    }
  } else {
    if (!data) {
      return res.status(404).json({
        response: false,
        status: "NOT FOUND",
        messages: `A session (${session ?? ""}) informada não existe.`,
      });
    }

    if (data?.sessionkey !== sessionkey) {
      return res.status(404).json({
        response: false,
        status: "NOT FOUND",
        messages: `A sessionkey (${
          sessionkey ?? ""
        }) informada não existe ou não está associada a sessão (${
          session ?? ""
        }).`,
      });
    }
  }

  next();
};

exports.checkParams = checkParams;
