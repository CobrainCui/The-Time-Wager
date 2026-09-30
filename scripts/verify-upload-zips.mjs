import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const py = `
import sys, zipfile
from collections import Counter

def check(path, must):
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
    missing = [m for m in must if m not in names]
    print(path, "entries", len(names), "missing", len(missing))
    for m in missing[:30]:
        print("  MISSING", m)
    return len(missing) == 0

root = sys.argv[1]
eras = [f"images/eras/{n}.jpg" for n in ("climate","tech","culture","health","mind")]
buffs = [f"images/buffs/{n}.jpg" for n in (
    "buff_slack","buff_insurance","buff_gold","buff_force_buy",
    "buff_short","buff_work_rest","buff_lighter","buff_lottery")]
personas = [f"images/personas/{n}.jpg" for n in ("Bridge","Moment","Navigator","Planter","Poet","Wave")]
projects = [f"images/projects/{i}.jpg" for i in list(range(1,11))+list(range(101,108))+list(range(201,209))]
ok1 = check(f"{root}/dist_upload.zip", eras+buffs+personas+projects)

era_cn = [f"data/uploads_eras/{n}.jpg" for n in ("气候","科技","文化","健康","心理")]
buff_up = [f"data/uploads_buffs/{n}.jpg" for n in (
    "buff_slack","buff_insurance","buff_gold","buff_force_buy",
    "buff_short","buff_work_rest","buff_lighter","buff_lottery")]
pers_up = [f"data/uploads_personas/{n}.jpg" for n in ("Bridge","Moment","Navigator","Planter","Poet","Wave")]
proj_up = [f"data/uploads/{i}.jpg" for i in list(range(1,11))+list(range(101,108))+list(range(201,209))]
ok2 = check(f"{root}/server_upload.zip", era_cn+buff_up+pers_up+proj_up)
sys.exit(0 if ok1 and ok2 else 1)
`;

const r = spawnSync("python", ["-c", py, root], { encoding: "utf8" });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status || 0);
