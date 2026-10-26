#!/usr/bin/env node
// obsidian-vault-bridge —— 自动定位本机 Obsidian 库，再交给 obsidian-mcp 提供服务。
//
// 为什么需要这一层：obsidian-mcp 只接受 `--vault <id>=<绝对路径>` 命令行参数、不读环境变量，
// 而 MCP 连接器的「用户自填」只能把值注入 env。所以本包负责定位库、拼出参数，
// 然后把 stdio 原样透传给真正的 MCP 服务端。
//
// 上游实现与全部笔记读写能力来自 obsidian-mcp
//   https://github.com/StevenStavrakis/obsidian-mcp  (MIT, Copyright (c) 2024 Steven Stavrakis)
// 本包只是启动参数的适配层。

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const log = (msg) => process.stderr.write(msg + '\n');

// ---------- 定位 Obsidian 的库注册表 ----------
function registryPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appdata, 'obsidian', 'obsidian.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, 'obsidian', 'obsidian.json');
}

// 读注册表里登记过的库。Obsidian 打开过的库都会留在这里。
function detectVaults() {
  const rp = registryPath();
  if (!fs.existsSync(rp)) return { file: rp, paths: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(rp, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { file: rp, paths: [] };
  }
  const paths = [];
  for (const v of Object.values(parsed?.vaults || {})) {
    if (v && typeof v.path === 'string') paths.push(v.path);
  }
  return { file: rp, paths: [...new Set(paths)] };
}

// ---------- 生成合法 vault id ----------
// obsidian-mcp 要求：小写字母开头，只含小写字母、数字、下划线、连字符。
function makeId(vaultPath, index, used) {
  const base = path.basename(vaultPath.replace(/[\\/]+$/, '')) || 'vault';
  let id = base.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(id)) id = 'v' + id;
  if (!id) id = 'vault';
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = id + '-' + n++;
  used.add(candidate);
  return candidate;
}

// ---------- 决定最终用哪些库 ----------
function resolveVaults() {
  const explicit = (process.env.OBSIDIAN_VAULT_PATH || '').trim();
  const customIds = (process.env.OBSIDIAN_VAULT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let dirs;
  if (explicit) {
    dirs = explicit.split(';').map((s) => s.trim()).filter(Boolean);
  } else {
    dirs = detectVaults().paths;
  }

  const used = new Set();
  return dirs.map((p, i) => {
    const abs = path.resolve(p);
    const id = customIds[i] || makeId(abs, i, used);
    return { id, path: abs, exists: fs.existsSync(abs), hasObsidianDir: fs.existsSync(path.join(abs, '.obsidian')) };
  });
}

// ---------- 入口 ----------
const argv = process.argv.slice(2);
const doctor = argv.includes('--doctor');
const passthrough = argv.filter((a) => a !== '--doctor');

const vaults = resolveVaults();

if (doctor) {
  const reg = detectVaults();
  log('obsidian-vault-bridge 诊断');
  log('  平台: ' + process.platform);
  log('  注册表: ' + reg.file + (fs.existsSync(reg.file) ? '（存在）' : '（不存在）'));
  log('  注册表内的库: ' + (reg.paths.length ? reg.paths.join(' , ') : '无'));
  log('  最终使用的库:');
  for (const v of vaults) {
    log('    ' + v.id + ' = ' + v.path + (v.exists ? '' : '  [不存在]') + (v.hasObsidianDir ? '' : '  [缺少 .obsidian 目录]'));
  }
  if (!vaults.length) log('  -> 没找到任何库，请设置 OBSIDIAN_VAULT_PATH');
  process.exit(vaults.length ? 0 : 1);
}

if (!vaults.length) {
  log('obsidian-vault-bridge: 没找到 Obsidian 库。');
  log('  请至少打开一次 Obsidian 让它登记库，或设置环境变量 OBSIDIAN_VAULT_PATH 指向库目录。');
  log('  多个库用英文分号分隔，例如 OBSIDIAN_VAULT_PATH=D:\\MyVault;D:\\WorkVault');
  process.exit(1);
}

for (const v of vaults) {
  if (!v.exists) {
    log('obsidian-vault-bridge: 库路径不存在 -> ' + v.path);
    process.exit(1);
  }
  if (!v.hasObsidianDir) {
    log('obsidian-vault-bridge: 该目录不是 Obsidian 库（缺少 .obsidian）-> ' + v.path);
    process.exit(1);
  }
}

let mainJs;
try {
  mainJs = require.resolve('obsidian-mcp');
} catch {
  log('obsidian-vault-bridge: 未能定位 obsidian-mcp，请重新安装本包。');
  process.exit(1);
}

const args = [mainJs, 'serve', ...passthrough];
for (const v of vaults) args.push('--vault', v.id + '=' + v.path);

log('obsidian-vault-bridge: 启动 ' + vaults.map((v) => v.id + '=' + v.path).join(' , '));

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('error', (err) => {
  log('obsidian-vault-bridge: 启动 obsidian-mcp 失败 -> ' + err.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
