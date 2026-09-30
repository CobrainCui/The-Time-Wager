/**
 * Create dist_upload.zip + server_upload.zip with UTF-8 filenames
 * (avoids PowerShell Compress-Archive garbling Chinese names).
 * Run from repo root after frontend/server build + pack-server-seed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const py = `
import os, sys, zipfile
from pathlib import Path

root = Path(sys.argv[1])

def zip_dir(src: Path, dest: Path, arc_prefix: str = ""):
    if dest.exists():
        dest.unlink()
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for dirpath, _, filenames in os.walk(src):
            for name in filenames:
                full = Path(dirpath) / name
                rel = full.relative_to(src).as_posix()
                arc = f"{arc_prefix}{rel}" if arc_prefix else rel
                # ZipInfo with UTF-8 flag
                info = zipfile.ZipInfo(arc)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.flag_bits |= 0x800  # language encoding flag (UTF-8)
                data = full.read_bytes()
                zf.writestr(info, data)

# Frontend dist
zip_dir(root / "frontend" / "dist", root / "dist_upload.zip")

# Server stage: dist/, package files, data/
stage = root / "_pack_staging" / "server"
out = root / "server_upload.zip"
if out.exists():
    out.unlink()
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    items = [
        (stage / "dist", "dist"),
        (stage / "package.json", "package.json"),
        (stage / "package-lock.json", "package-lock.json"),
        (stage / ".env.example", ".env.example"),
        (stage / "data", "data"),
    ]
    for src, arc_base in items:
        if not src.exists():
            raise SystemExit(f"missing {src}")
        if src.is_file():
            info = zipfile.ZipInfo(arc_base)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.flag_bits |= 0x800
            zf.writestr(info, src.read_bytes())
        else:
            for dirpath, _, filenames in os.walk(src):
                for name in filenames:
                    full = Path(dirpath) / name
                    rel = full.relative_to(src).as_posix()
                    arc = f"{arc_base}/{rel}"
                    info = zipfile.ZipInfo(arc)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.flag_bits |= 0x800
                    zf.writestr(info, full.read_bytes())

print("ok", (root / "dist_upload.zip").stat().st_size, (root / "server_upload.zip").stat().st_size)
`;

const r = spawnSync("python", ["-c", py, root], { encoding: "utf8" });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) process.exit(r.status || 1);
