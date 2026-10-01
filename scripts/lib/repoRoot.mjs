import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录（与从哪条 cwd 执行无关） */
export function getRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function getFrontendDistDir() {
  return path.join(getRepoRoot(), "frontend", "dist");
}
