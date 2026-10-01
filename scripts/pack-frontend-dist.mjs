/**
 * 本地上传部署：构建并打包 frontend/dist。
 * 用法（仓库根目录）：
 *   node scripts/pack-frontend-dist.mjs
 * 上传前在服务器删除网站根目录下的 assets/，再解压 dist_upload.zip 到站点根目录。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRepoRoot } from "./lib/repoRoot.mjs";

const root = getRepoRoot();
const frontend = path.join(root, "frontend");
const dist = path.join(frontend, "dist");
const zipPath = path.join(root, "dist_upload.zip");

execSync("npm run build", { cwd: frontend, stdio: "inherit" });

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// tar -a 在 Windows 10+ / Linux / macOS 上生成 zip，避免 PowerShell 路径编码问题
execSync(`tar -a -c -f "${zipPath}" -C "${dist}" .`, { stdio: "inherit", cwd: root });

console.log(`\nPacked: ${zipPath}`);
console.log("Upload: unzip to site root after removing old assets/ on the server.");
