#!/usr/bin/env node
/**
 * AI Task Workbench — Windows 内网部署打包脚本
 *
 * 用途：在开发机上执行，自动构建所有工作区并将产物打包为可直接部署的 ZIP 文件。
 * 生成的 ZIP 包无需互联网即可在 Windows 内网环境运行。
 *
 * 前置条件：
 *   - Node.js 18+
 *   - 已执行 npm install（有 node_modules）
 *   - Git（用于版本号）
 *
 * 用法：
 *   node scripts/prepare-deploy.mjs               # 默认打包
 *   node scripts/prepare-deploy.mjs --skip-build  # 跳过构建（仅打包已有产物）
 *   node scripts/prepare-deploy.mjs --output-dir ./release  # 指定输出目录
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── 参数解析 ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const outputDirIdx = args.indexOf("--output-dir");
const outputDir = outputDirIdx !== -1 && args[outputDirIdx + 1]
  ? path.resolve(args[outputDirIdx + 1])
  : path.resolve(ROOT, "deploy-output");

// ─── 版本信息 ──────────────────────────────────────────────────────────
let version = "0.1.0";
let commitHash = "unknown";
try {
  version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).version || "0.1.0";
  commitHash = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf-8" }).trim();
} catch {
  // 降级处理
}

const DEPLOY_NAME = "ai-task-workbench-v" + version + "-" + commitHash;
const DEPLOY_DIR = path.join(outputDir, DEPLOY_NAME);

console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║   AI Task Workbench — Windows 内网部署打包工具          ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log();
console.log("  版本: " + version);
console.log("  提交: " + commitHash);
console.log("  输出: " + outputDir);
console.log();

// ─── 工具函数 ──────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  console.log("  ▶ " + cmd);
  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
  } catch (err) {
    console.error("  ✗ 命令失败: " + cmd);
    process.exit(1);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn("  ⚠ 源路径不存在: " + src);
    return;
  }
  if (fs.statSync(src).isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ─── Step 1: 构建 ──────────────────────────────────────────────────────
if (!skipBuild) {
  console.log("━━━ Step 1/4: 构建所有工作区 ━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  run("npm run build --workspace=shared");
  run("npm run build --workspace=src-engine");
  run("npm run build --workspace=src-ui");
  console.log("  ✓ 构建完成\n");
} else {
  console.log("━━━ Step 1/4: 跳过构建（--skip-build）━━━━━━━━━━━━━━━━━━━");
  const requiredPaths = [
    path.join(ROOT, "src-engine/dist/engine.js"),
    path.join(ROOT, "src-ui/dist/index.html"),
  ];
  for (const p of requiredPaths) {
    if (!fs.existsSync(p)) {
      console.error("  ✗ 构建产物不存在: " + p);
      console.error("  请先执行: npm run build");
      process.exit(1);
    }
  }
  console.log("  ✓ 构建产物验证通过\n");
}

// ─── Step 2: 创建部署目录 ──────────────────────────────────────────────
console.log("━━━ Step 2/4: 创建部署目录 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

if (fs.existsSync(DEPLOY_DIR)) {
  fs.rmSync(DEPLOY_DIR, { recursive: true });
}
ensureDir(DEPLOY_DIR);

// 2a. 引擎 — 保持 src-engine/dist/ 路径（生产模式 ws-server 按相对路径查找前端）
const engineDir = path.join(DEPLOY_DIR, "src-engine", "dist");
ensureDir(engineDir);
fs.copyFileSync(
  path.join(ROOT, "src-engine", "dist", "engine.js"),
  path.join(engineDir, "engine.js")
);
const engineMap = path.join(ROOT, "src-engine", "dist", "engine.js.map");
if (fs.existsSync(engineMap)) {
  fs.copyFileSync(engineMap, path.join(engineDir, "engine.js.map"));
}
console.log("  ✓ 引擎已复制: src-engine/dist/engine.js");

// 2b. 前端 — 保持 src-ui/dist/ 路径
const frontendSrc = path.join(ROOT, "src-ui", "dist");
const frontendDest = path.join(DEPLOY_DIR, "src-ui", "dist");
copyRecursive(frontendSrc, frontendDest);
console.log("  ✓ 前端已复制: src-ui/dist/");

// 2c. 内置技能文件
// 打包后 import.meta.dirname 指向 src-engine/dist/，
// BUILTIN_SKILLS_DIR = resolve(import.meta.dirname, "../../resources/skills/builtin")
// 即 dist/ → src-engine/ → deploy-root/ → deploy-root/resources/skills/builtin
const skillsDir = path.join(ROOT, "src-engine", "resources", "skills");
if (fs.existsSync(skillsDir)) {
  const skillsDest = path.join(DEPLOY_DIR, "resources", "skills");
  copyRecursive(skillsDir, skillsDest);
  console.log("  ✓ 内置技能已复制 → resources/skills/");
}

// 2d. package.json（ESM 支持 — engine.js 是 ESM 格式）
const packageJson = {
  name: "ai-task-workbench-deploy",
  version: version,
  private: true,
  type: "module",
  description: "AI Task Workbench 部署包",
};
fs.writeFileSync(
  path.join(DEPLOY_DIR, "package.json"),
  JSON.stringify(packageJson, null, 2) + "\n"
);
console.log("  ✓ package.json 已创建（type: module）");

// 2e. .env.production 模板
const envLines = [
  "# ===========================================",
  "# AI Task Workbench — 生产环境配置",
  "# ===========================================",
  "# 复制此文件为 .env 并根据实际情况修改",
  "#",
  "# 使用方式:",
  "#   copy .env.production .env",
  "#   然后编辑 .env 文件",
  "# ===========================================",
  "",
  "# 引擎服务端口（默认 9731）",
  "ENGINE_PORT=9731",
  "",
  "# 引擎监听地址（0.0.0.0 允许所有网卡访问）",
  "ENGINE_HOST=0.0.0.0",
  "",
  "# 运行模式（生产环境请保持 production）",
  "NODE_ENV=production",
  "",
  "# 日志级别: debug | info | warn | error",
  "LOG_LEVEL=info",
  "",
  "# CORS 允许的额外来源（逗号分隔）",
  "# 内网环境可设置为: http://内网IP:9731",
  "CORS_ORIGINS=",
  "",
  "# Claude CLI 路径（默认从 PATH 查找）",
  "# Windows 下通常为 claude 或 claude.cmd",
  "# 如果 claude 不在 PATH 中，请填写完整路径，例如:",
  "# CLAUDE_PATH=C:\\Users\\用户名\\AppData\\Roaming\\npm\\claude.cmd",
  "CLAUDE_PATH=claude",
  "",
];
const envContent = envLines.join("\r\n") + "\r\n";
fs.writeFileSync(path.join(DEPLOY_DIR, ".env.production"), envContent);
fs.writeFileSync(path.join(DEPLOY_DIR, ".env"), envContent);
console.log("  ✓ .env.production / .env 已创建");

console.log();

// ─── Step 3: 创建 Windows 批处理脚本 ────────────────────────────────────
console.log("━━━ Step 3/4: 创建 Windows 启动脚本 ━━━━━━━━━━━━━━━━━━━━");

// ── start.bat ──
const startBatLines = [
  "@echo off",
  "chcp 65001 >nul 2>&1",
  "title AI Task Workbench Engine",
  "",
  ":: ===========================================",
  ":: AI Task Workbench — Windows 启动脚本",
  ":: ===========================================",
  "",
  ":: 切换到脚本所在目录",
  "cd /d \"%~dp0\"",
  "",
  ":: 检查 Node.js",
  "where node >nul 2>&1",
  "if errorlevel 1 (",
  "    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+",
  "    echo 下载地址: https://nodejs.org/",
  "    pause",
  "    exit /b 1",
  ")",
  "",
  ":: 检查引擎文件",
  "if not exist \"src-engine\\dist\\engine.js\" (",
  "    echo [错误] 引擎文件不存在: src-engine\\dist\\engine.js",
  "    echo 请确认部署包完整",
  "    pause",
  "    exit /b 1",
  ")",
  "",
  ":: 检查前端文件",
  "if not exist \"src-ui\\dist\\index.html\" (",
  "    echo [警告] 前端文件不存在: src-ui\\dist\\index.html",
  "    echo 引擎将以无前端模式启动",
  ")",
  "",
  ":: 加载 .env 配置（使用 Node.js 解析，兼容 LF/CRLF）",
  "if exist \".env\" (",
  "    echo [信息] 加载 .env 配置...",
  "    for /f \"usebackq delims=\" %%e in (`node -e \"require('fs').readFileSync('.env','utf8').split(/\\r?\\n/).filter(function(l){l=l.trim();return l&&l.indexOf('#')!==0&&l.includes('=')}).forEach(function(l){var i=l.indexOf('=');console.log(l.substring(0,i)+'='+l.substring(i+1))})\"`) do set \"%%e\"",
  ") else if exist \".env.production\" (",
  "    echo [信息] 加载 .env.production 配置...",
  "    for /f \"usebackq delims=\" %%e in (`node -e \"require('fs').readFileSync('.env.production','utf8').split(/\\r?\\n/).filter(function(l){l=l.trim();return l&&l.indexOf('#')!==0&&l.includes('=')}).forEach(function(l){var i=l.indexOf('=');console.log(l.substring(0,i)+'='+l.substring(i+1))})\"`) do set \"%%e\"",
  ")",
  "",
  ":: 设置默认值",
  "if not defined NODE_ENV set NODE_ENV=production",
  "if not defined ENGINE_PORT set ENGINE_PORT=9731",
  "if not defined ENGINE_HOST set ENGINE_HOST=0.0.0.0",
  "if not defined LOG_LEVEL set LOG_LEVEL=info",
  "",
  "echo.",
  "echo ========================================================",
  "echo            AI Task Workbench 引擎启动中...",
  "echo ========================================================",
  "echo   端口: %ENGINE_PORT%",
  "echo   地址: %ENGINE_HOST%",
  "echo   模式: %NODE_ENV%",
  "echo ========================================================",
  "echo.",
  "echo [信息] 按 Ctrl+C 停止引擎",
  "echo [信息] 浏览器访问: http://localhost:%ENGINE_PORT%",
  "echo.",
  "",
  ":: 启动引擎",
  "node src-engine\\dist\\engine.js",
  "",
  "if errorlevel 1 (",
  "    echo.",
  "    echo [错误] 引擎异常退出，退出码: %errorlevel%",
  "    pause",
  ")",
  "",
];
fs.writeFileSync(path.join(DEPLOY_DIR, "start.bat"), startBatLines.join("\r\n") + "\r\n");
console.log("  ✓ start.bat 已创建");

// ── stop.bat ──
const stopBatLines = [
  "@echo off",
  "chcp 65001 >nul 2>&1",
  ":: ===========================================",
  ":: AI Task Workbench — Windows 停止脚本",
  ":: ===========================================",
  "",
  ":: 加载端口配置",
  "set ENGINE_PORT=9731",
  "if exist \"%~dp0.env\" (",
  "    for /f \"usebackq tokens=1,* delims==\" %%a in (\"%~dp0.env\") do (",
  "        if \"%%a\"==\"ENGINE_PORT\" set \"ENGINE_PORT=%%b\"",
  "    )",
  ")",
  "",
  "echo [信息] 正在停止引擎 (端口 %ENGINE_PORT%)...",
  "",
  ":: 方式 1: HTTP shutdown（优雅关闭）",
  "powershell -Command \"try { Invoke-WebRequest -Uri 'http://localhost:%ENGINE_PORT%/api/shutdown' -Method POST -UseBasicParsing -TimeoutSec 5 } catch {}\"",
  "timeout /t 2 /nobreak >nul",
  "",
  ":: 检查是否已停止",
  "powershell -Command \"try { $r = Invoke-WebRequest -Uri 'http://localhost:%ENGINE_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; exit 1 } catch { exit 0 }\"",
  "if errorlevel 1 (",
  "    echo [警告] 引擎仍在运行，尝试强制终止...",
  "    for /f \"tokens=2\" %%p in ('tasklist /fi \"imagename eq node.exe\" /fo list ^| find \"PID\"') do (",
  "        wmic process where \"ProcessId=%%p\" get CommandLine 2>nul | find \"engine.js\" >nul 2>&1",
  "        if not errorlevel 1 (",
  "            echo [信息] 终止引擎进程 PID=%%p",
  "            taskkill /pid %%p /f >nul 2>&1",
  "        )",
  "    )",
  ") else (",
  "    echo [信息] 引擎已停止",
  ")",
  "",
  "echo [信息] 完成",
  "",
];
fs.writeFileSync(path.join(DEPLOY_DIR, "stop.bat"), stopBatLines.join("\r\n") + "\r\n");
console.log("  ✓ stop.bat 已创建");

// ── status.bat ──
const statusBatLines = [
  "@echo off",
  "chcp 65001 >nul 2>&1",
  ":: ===========================================",
  ":: AI Task Workbench — Windows 状态检查脚本",
  ":: ===========================================",
  "",
  "set ENGINE_PORT=9731",
  "if exist \"%~dp0.env\" (",
  "    for /f \"usebackq tokens=1,* delims==\" %%a in (\"%~dp0.env\") do (",
  "        if \"%%a\"==\"ENGINE_PORT\" set \"ENGINE_PORT=%%b\"",
  "    )",
  ")",
  "",
  "echo [信息] 检查引擎状态 (端口 %ENGINE_PORT%)...",
  "",
  "powershell -Command \"try { $r = Invoke-WebRequest -Uri 'http://localhost:%ENGINE_PORT%/api/health' -UseBasicParsing -TimeoutSec 3; Write-Host '[运行中] 引擎正常运行在端口 %ENGINE_PORT%'; Write-Host ''; Write-Host $r.Content } catch { Write-Host '[已停止] 引擎未运行在端口 %ENGINE_PORT%' }\"",
  "",
];
fs.writeFileSync(path.join(DEPLOY_DIR, "status.bat"), statusBatLines.join("\r\n") + "\r\n");
console.log("  ✓ status.bat 已创建");

// ── open-browser.bat ──
const openBrowserBatLines = [
  "@echo off",
  "chcp 65001 >nul 2>&1",
  ":: ===========================================",
  ":: AI Task Workbench — 打开浏览器",
  ":: ===========================================",
  "",
  "set ENGINE_PORT=9731",
  "if exist \"%~dp0.env\" (",
  "    for /f \"usebackq tokens=1,* delims==\" %%a in (\"%~dp0.env\") do (",
  "        if \"%%a\"==\"ENGINE_PORT\" set \"ENGINE_PORT=%%b\"",
  "    )",
  ")",
  "",
  "echo [信息] 正在打开浏览器...",
  "start http://localhost:%ENGINE_PORT%",
  "",
];
fs.writeFileSync(path.join(DEPLOY_DIR, "open-browser.bat"), openBrowserBatLines.join("\r\n") + "\r\n");
console.log("  ✓ open-browser.bat 已创建");

console.log();

// ─── Step 4: 创建部署文档 ───────────────────────────────────────────────
console.log("━━━ Step 4/4: 创建部署文档 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

// 从模板文件读取 README 并替换变量
const readmeTemplate = fs.readFileSync(
  path.join(__dirname, "deploy-readme-template.md"),
  "utf-8"
);
const readme = readmeTemplate
  .replaceAll("{{VERSION}}", version)
  .replaceAll("{{COMMIT}}", commitHash)
  .replaceAll("{{DATE}}", new Date().toISOString().split("T")[0]);

fs.writeFileSync(path.join(DEPLOY_DIR, "README.md"), readme);
console.log("  ✓ README.md 已创建");

// ─── 打包 ZIP ──────────────────────────────────────────────────────────
console.log();
console.log("━━━ 打包 ZIP 文件 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const zipPath = path.join(outputDir, DEPLOY_NAME + ".zip");

// 使用系统命令打包（无第三方依赖，macOS/Linux/Windows 均支持）
try {
  // 删除旧 ZIP
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  execSync("zip -r -q \"" + zipPath + "\" \"" + DEPLOY_NAME + "\"", {
    cwd: outputDir,
    stdio: "inherit",
  });

  const sizeBytes = fs.statSync(zipPath).size;
  const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
  console.log("  ✓ ZIP 已创建: " + zipPath);
  console.log("  ✓ 文件大小: " + sizeMB + " MB");
} catch (err) {
  console.warn("  ⚠ ZIP 打包失败（不影响部署目录）: " + err.message);
  console.warn("  可手动压缩: cd " + outputDir + " && zip -r " + DEPLOY_NAME + ".zip " + DEPLOY_NAME);
}

console.log();
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║              打包完成！                                  ║");
console.log("╠══════════════════════════════════════════════════════════╣");
console.log("║  部署目录: " + DEPLOY_DIR);
console.log("║  ZIP 文件: " + zipPath);
console.log("║                                                          ║");
console.log("║  下一步:                                                  ║");
console.log("║  1. 将 ZIP 文件传输到 Windows 目标机器                    ║");
console.log("║  2. 解压到目标目录 (如 C:\\ai-task-workbench\\)           ║");
console.log("║  3. 编辑 .env 配置文件                                   ║");
console.log("║  4. 双击 start.bat 启动引擎                              ║");
console.log("║  5. 浏览器访问 http://localhost:9731                      ║");
console.log("╚══════════════════════════════════════════════════════════╝");
