"use strict";
/**
 * Regressão do BOOT (incidente de frota 01/09): o primeiro boot de um pack
 * novo levava >60s até o listen (requires de wwebjs/puppeteer + antivírus) e
 * o gerenciador matava o processo no meio do aquecimento — loop de morte.
 *
 * Dois marcos, cortesia do gerenciador (sessão irmã):
 *   1. PORTA responde em < LIMITE_PORTA_MS  → listen-early vivo. Se este
 *      regredir, alguém pôs require pesado antes do server.listen de novo.
 *   2. /health SEM "starting" em < LIMITE_NUCLEO_MS → carregarNucleo() sobe
 *      e monta as rotas (um throw no núcleo viraria zumbi "starting" eterno).
 *
 * Roda com o repo real (precisa de node_modules instalado; o browser do
 * puppeteer NÃO é necessário — só o require do módulo).
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const LIMITE_PORTA_MS = 5000;
const LIMITE_NUCLEO_MS = 120000;
const PORT = process.env.BOOT_TEST_PORT || "5599";

const repoDir = path.join(__dirname, "..");
// cwd separado: instances/ e database/ do teste não sujam o repo
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "myzap-boot-"));

const env = {
  ...process.env,
  PORT,
  TOKEN: "boot-test-token",
  CORS_ORIGIN: "*",
  ENGINE: "1",
  HOST: "http://localhost",
  START_ALL_SESSIONS: "false",
  IA_PROVIDER: "agente",
  // audioTranscriber instancia o client no require; a chave não é usada aqui
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-boot-test-dummy",
};

let saida = "";
let saiu = null;
const proc = spawn(process.execPath, [path.join(repoDir, "index.js")], {
  cwd: dataDir,
  env,
  windowsHide: true,
});
proc.stdout.on("data", (d) => (saida += d));
proc.stderr.on("data", (d) => (saida += d));
proc.on("exit", (code, sig) => (saiu = { code, sig }));

const probe = () =>
  new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: "/health", timeout: 2000 },
      (res) => {
        let corpo = "";
        res.on("data", (d) => (corpo += d));
        res.on("end", () => resolve({ status: res.statusCode, corpo }));
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });

const falhar = (msg) => {
  console.error(`BOOT-TEST FALHOU: ${msg}`);
  console.error("--- últimas linhas do processo ---");
  console.error(saida.split("\n").slice(-40).join("\n"));
  try {
    proc.kill();
  } catch (_e) {}
  process.exit(1);
};

(async () => {
  const inicio = Date.now();

  // Marco 1: porta viva (qualquer resposta do /health)
  let primeira = null;
  while (Date.now() - inicio < LIMITE_PORTA_MS) {
    if (saiu) falhar(`processo morreu antes da porta (code=${saiu.code})`);
    primeira = await probe();
    if (primeira) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!primeira) {
    falhar(
      `porta não respondeu em ${LIMITE_PORTA_MS / 1000}s — require pesado antes do listen?`
    );
  }
  const msPorta = Date.now() - inicio;
  console.log(
    `marco 1 OK: porta respondeu em ${msPorta}ms (${
      primeira.corpo.includes('"starting":true') ? "starting" : "completo direto"
    })`
  );

  // Marco 2: núcleo completo (health sem "starting")
  let completo = primeira.corpo.includes('"starting":true') ? null : primeira;
  while (!completo && Date.now() - inicio < LIMITE_NUCLEO_MS) {
    if (saiu) falhar(`processo morreu aquecendo o núcleo (code=${saiu.code})`);
    const r = await probe();
    if (r && !r.corpo.includes('"starting":true')) completo = r;
    else await new Promise((res) => setTimeout(res, 1000));
  }
  if (!completo) {
    falhar(
      `núcleo não completou em ${LIMITE_NUCLEO_MS / 1000}s — zumbi "starting" (throw no carregarNucleo?)`
    );
  }
  const msNucleo = Date.now() - inicio;
  console.log(`marco 2 OK: health completo em ${msNucleo}ms (HTTP ${completo.status})`);
  console.log(`BOOT-TEST OK: porta=${msPorta}ms nucleo=${msNucleo}ms`);

  try {
    proc.kill();
  } catch (_e) {}
  setTimeout(() => process.exit(0), 1500);
})();
