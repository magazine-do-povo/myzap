#!/usr/bin/env node
/**
 * Monta o MyZap RUNTIME PACK — o artefato PRONTO PARA RODAR que o
 * gerenciadorMyzap baixa e troca de forma atomica (com rollback).
 *
 * Produz em dist-pack/:
 *   - myzap-pack-win32-x64.zip            -> codigo (dieta ENGINE=1) +
 *       node_modules ja instalado (hoisted, --prod) + Chromium do puppeteer
 *       (.puppeteer-cache) + Node.js embutido (node/node.exe) + semente do
 *       banco GERADA PELAS MIGRATIONS (seed/db.sqlite) + cache do WhatsApp
 *       Web pre-populado (.wwebjs_cache, melhor esforco).
 *   - myzap-pack-win32-x64.manifest.json  -> versao, sha, plataforma, node,
 *       sha256 do zip. E ESTE arquivo que o gerenciador consulta no canal
 *       de releases para decidir se ha atualizacao.
 *
 * Por que Node embutido: o sqlite3 e resolvido por prebuild do par
 * (SO, arch, major do Node). Embutindo o MESMO Node que roda este build,
 * o pack nunca depende do runtime do gerenciador (Electron) — o app pode
 * subir de Electron sem invalidar o motor silenciosamente.
 *
 * Uso:
 *   node scripts/build-pack.js [--skip-browser] [--skip-node] [--keep-work]
 *
 * Roda no CI (windows-latest) e em maquina de dev Windows. O manifest grava
 * a plataforma; o gerenciador ignora pack de plataforma incompativel.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync, execSync } = require('child_process');

const PNPM_VERSION = '9.15.4'; // packageManager declarado pelo MyZap
const SEQUELIZE_CLI_VERSION = '6.6.2';
// Mesma versao pinada pelo envTemplate do gerenciador — o cache pre-populado
// so serve se casar com a WHATSAPP_VERSION que o cliente vai usar.
const DEFAULT_WA_VERSION = '2.3000.1017155554';
const MAX_REDIRECTS = 5;

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'dist-pack');
const workDir = path.join(outDir, '.work');
const pkgDir = path.join(workDir, 'pkg');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const skipBrowser = flag('--skip-browser');
const skipNode = flag('--skip-node');
const keepWork = flag('--keep-work');

const platformTag = `${process.platform}-${process.arch}`;
const zipName = `myzap-pack-${platformTag}.zip`;
const manifestName = `myzap-pack-${platformTag}.manifest.json`;
const zipPath = path.join(outDir, zipName);
const manifestPath = path.join(outDir, manifestName);

function log(msg) { process.stdout.write(`[pack] ${msg}\n`); }
function fail(msg) { process.stderr.write(`[pack] ERRO: ${msg}\n`); process.exit(1); }
function rmrf(target) { fs.rmSync(target, { recursive: true, force: true }); }

function httpGet(url, { headers = {}, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'myzap-pack-builder', ...headers },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error(`redirecionamentos demais para ${url}`));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        httpGet(next, { headers, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }
      resolve(res);
    });
    req.setTimeout(120000, () => req.destroy(new Error(`timeout ao baixar ${url}`)));
    req.on('error', reject);
  });
}

async function downloadTo(url, dest) {
  const res = await httpGet(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`download falhou (HTTP ${res.statusCode}): ${url}`);
  }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.pipe(out);
    out.on('finish', () => out.close(resolve));
    out.on('error', reject);
    res.on('error', reject);
  });
}

function run(cmd, cmdArgs, options = {}) {
  log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  // No Windows com shell:true os args sao concatenados sem escape: caminhos
  // com espaco quebrariam sem as aspas.
  const winShell = process.platform === 'win32' && options.shell;
  const quote = (v) => (/\s/.test(String(v)) ? `"${v}"` : String(v));
  const finalCmd = winShell ? quote(cmd) : cmd;
  const finalArgs = winShell ? cmdArgs.map(quote) : cmdArgs;
  const result = spawnSync(finalCmd, finalArgs, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status === 0;
}

/**
 * tar do WINDOWS (bsdtar de System32), por caminho absoluto. O PATH de uma
 * maquina de dev costuma ter o GNU tar do Git Bash na frente, que trata
 * "C:\..." como host remoto ("Cannot connect to C:") e nao sabe gerar .zip
 * com -a. O bsdtar nativo faz as duas coisas.
 */
function windowsTar() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

/**
 * Zip com o CONTEUDO de dir na raiz do arquivo. Windows: tar.exe nativo
 * (bsdtar entende .zip) — mesmo caminho comprovado do snapshot builder do
 * gerenciador (o extract-zip/yauzl pendura em Node >= 24, entao nada de
 * bibliotecas JS aqui).
 */
function zipDirectory(dir, destZip) {
  rmrf(destZip);
  if (process.platform === 'win32') {
    if (run(windowsTar(), ['-a', '-cf', destZip, '-C', dir, '.'])) return;
    throw new Error('tar.exe falhou ao criar o zip');
  }
  if (run('zip', ['-qry', destZip, '.'], { cwd: dir })) return;
  throw new Error('zip falhou ao criar o arquivo');
}

function unzipTo(zipFile, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    if (run(windowsTar(), ['-xf', zipFile, '-C', destDir])) return;
    throw new Error('tar.exe falhou ao extrair');
  }
  if (run('unzip', ['-q', zipFile, '-d', destDir])) return;
  throw new Error('unzip falhou ao extrair');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function gitHeadSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim();
  } catch (_e) {
    return null;
  }
}

/** Copia o codigo RASTREADO pelo git (git ls-files): nada de node_modules,
 *  dist, lixo local — o pack nasce do que esta commitado. Sem tar aqui de
 *  proposito: o GNU tar do Git Bash quebra com caminhos "C:\...". */
function exportSource() {
  fs.mkdirSync(pkgDir, { recursive: true });
  const listed = execSync('git ls-files -z', { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  const files = listed.toString('utf8').split('\0').filter(Boolean);
  for (const rel of files) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(pkgDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  log(`codigo exportado: ${files.length} arquivos rastreados`);

  // Dieta de conteudo: o dashboard local nao vai ao cliente (o gerenciador e
  // a UI). public/ pesa ~31MB de libs de front; Views/ (EJS) fica — e leve e
  // evita quebrar rotas de painel que alguem abra por engano.
  rmrf(path.join(pkgDir, 'public'));
  // Colecoes de exemplo/da comunidade nao pertencem ao runtime.
  rmrf(path.join(pkgDir, 'Insomnia'));
  rmrf(path.join(pkgDir, 'docs'));
}

async function main() {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const version = String(pkgJson.version || '0.0.0');
  const sha = gitHeadSha();
  const nodeVersion = process.versions.node;

  log(`plataforma: ${platformTag} | versao: ${version} | node: v${nodeVersion}${skipBrowser ? ' | SEM browser' : ''}${skipNode ? ' | SEM node embutido' : ''}`);

  fs.mkdirSync(outDir, { recursive: true });
  rmrf(workDir);
  fs.mkdirSync(workDir, { recursive: true });

  // 1) codigo limpo a partir do git
  log('exportando codigo (git archive)...');
  exportSource();

  // 2) node_modules movivel (hoisted) e SO producao
  fs.appendFileSync(path.join(pkgDir, '.npmrc'), '\nnode-linker=hoisted\n');
  const env = {
    ...process.env,
    PUPPETEER_CACHE_DIR: path.join(pkgDir, '.puppeteer-cache'),
    // o headless "shell" nao e usado — economiza ~120MB
    PUPPETEER_SKIP_CHROME_HEADLESS_SHELL_DOWNLOAD: 'true',
  };
  if (skipBrowser) env.PUPPETEER_SKIP_DOWNLOAD = 'true';

  const okInstall = run('npx', ['-y', `pnpm@${PNPM_VERSION}`, 'install', '--prod', '--no-frozen-lockfile'], {
    cwd: pkgDir,
    shell: true,
    env,
  });
  if (!okInstall) fail('pnpm install falhou');

  // Chromium como passo EXPLICITO e idempotente. Nao dependemos do
  // postinstall do puppeteer: o side-effects-cache do pnpm marca o pacote
  // como "ja construido" no store da maquina e PULA o script nas proximas
  // instalacoes — o Chromium ia para o cache do build anterior (apagado) e o
  // pack ficava sem browser. O install.mjs re-executa e sai rapido se o
  // download ja existe no PUPPETEER_CACHE_DIR do pack.
  if (!skipBrowser) {
    log('garantindo Chromium no cache do pack...');
    const okChrome = run('node', [path.join('node_modules', 'puppeteer', 'install.mjs')], {
      cwd: pkgDir,
      shell: true,
      env,
    });
    if (!okChrome) fail('download do Chromium (puppeteer install.mjs) falhou');
  }

  // 3) semente do banco GERADA pelas migrations — sempre em dia com o codigo.
  // (era um db.seed.sqlite mantido a mao no repo do gerenciador: cada
  // migration nova invalidava a semente em silencio)
  log('gerando semente do banco (migrations)...');
  rmrf(path.join(pkgDir, 'database'));
  const okMigrate = run('npx', ['-y', `sequelize-cli@${SEQUELIZE_CLI_VERSION}`, 'db:migrate', '--env', 'production'], {
    cwd: pkgDir,
    shell: true,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (!okMigrate) fail('sequelize-cli db:migrate falhou (semente do banco)');
  const dbGerado = path.join(pkgDir, 'database', 'db.sqlite');
  if (!fs.existsSync(dbGerado)) fail('migrations rodaram mas database/db.sqlite nao existe');
  fs.mkdirSync(path.join(pkgDir, 'seed'), { recursive: true });
  fs.renameSync(dbGerado, path.join(pkgDir, 'seed', 'db.sqlite'));
  // O engine e CODIGO: dados (database/) moram no diretorio de dados do
  // cliente. O gerenciador copia seed/db.sqlite para la quando nao existir.
  rmrf(path.join(pkgDir, 'database'));

  // 4) Node embutido — mesmo binario/major deste build (ABI do sqlite3 casado)
  if (!skipNode) {
    log(`baixando Node v${nodeVersion} (win-x64)...`);
    const nodeZip = path.join(workDir, 'node.zip');
    await downloadTo(`https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`, nodeZip);
    const nodeExtract = path.join(workDir, 'node-extract');
    unzipTo(nodeZip, nodeExtract);
    const nodeExeSrc = path.join(nodeExtract, `node-v${nodeVersion}-win-x64`, 'node.exe');
    if (!fs.existsSync(nodeExeSrc)) fail('node.exe nao encontrado no zip oficial');
    fs.mkdirSync(path.join(pkgDir, 'node'), { recursive: true });
    fs.copyFileSync(nodeExeSrc, path.join(pkgDir, 'node', 'node.exe'));
    rmrf(nodeZip);
    rmrf(nodeExtract);
  }

  // 5) cache do WhatsApp Web pre-populado (melhor esforco): primeiro boot
  // funciona sem internet ate aqui — sem isso o wwebjs precisa baixar o HTML
  // da versao pinada uma vez.
  try {
    const waVersion = process.env.WA_VERSION || DEFAULT_WA_VERSION;
    const cacheDir = path.join(pkgDir, '.wwebjs_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    await downloadTo(
      `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${waVersion}.html`,
      path.join(cacheDir, `${waVersion}.html`)
    );
    log(`cache do WhatsApp Web ${waVersion} embutido`);
  } catch (err) {
    log(`AVISO: nao consegui pre-popular o .wwebjs_cache (${err.message}) — primeiro boot buscara online`);
  }

  // 6) sanidade: o pacote precisa estar APTO A RODAR
  const precisaExistir = [
    'index.js',
    'package.json',
    path.join('node_modules', 'express'),
    path.join('node_modules', 'whatsapp-web.js'),
    path.join('node_modules', 'sqlite3'),
    path.join('seed', 'db.sqlite'),
  ];
  if (!skipNode) precisaExistir.push(path.join('node', 'node.exe'));
  for (const rel of precisaExistir) {
    if (!fs.existsSync(path.join(pkgDir, rel))) fail(`sanidade falhou: falta ${rel}`);
  }
  if (!skipBrowser && !fs.existsSync(path.join(pkgDir, '.puppeteer-cache', 'chrome'))) {
    fail('sanidade falhou: Chromium nao foi baixado para .puppeteer-cache/chrome');
  }
  // Engines removidas na dieta NAO podem estar no pack
  for (const proibido of ['venom-bot', '@wppconnect-team', 'sharp', 'pm2']) {
    if (fs.existsSync(path.join(pkgDir, 'node_modules', proibido))) {
      fail(`dieta falhou: node_modules/${proibido} veio junto`);
    }
  }
  // Smoke real: o Node EMBUTIDO precisa conseguir carregar o sqlite3 (prova
  // do ABI) e o whatsapp-web.js.
  if (!skipNode) {
    const okSmoke = run(path.join(pkgDir, 'node', 'node.exe'), ['-e',
      'require("sqlite3");require("whatsapp-web.js");console.log("[pack] smoke: sqlite3 + wwebjs OK")'
    ], { cwd: pkgDir });
    if (!okSmoke) fail('smoke falhou: o Node embutido nao carregou sqlite3/whatsapp-web.js');
  }

  // 7) manifest INTERNO (identidade da instalacao — o gerenciador le
  // <motor>/manifest.json para saber versao/modo pack) + zip + manifest
  // EXTERNO do canal (mesmo conteudo + sha256/tamanho do zip, que so
  // existem depois de compactar).
  const manifestBase = {
    schema: 1,
    name: 'myzap-pack',
    version,
    sha,
    platform: platformTag,
    nodeVersion,
    nodeEmbedded: !skipNode,
    chromiumEmbedded: !skipBrowser,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(pkgDir, 'manifest.json'), `${JSON.stringify(manifestBase, null, 2)}\n`);

  log('compactando pack...');
  zipDirectory(pkgDir, zipPath);
  const sizeBytes = fs.statSync(zipPath).size;
  const zipSha256 = sha256File(zipPath);

  const manifest = { ...manifestBase, sizeBytes, zipSha256 };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (!keepWork) rmrf(workDir);

  log(`OK: ${zipPath} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
  log(`manifest: ${JSON.stringify(manifest)}`);
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
