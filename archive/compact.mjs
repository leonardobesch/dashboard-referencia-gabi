// Comprime os registros brutos do CRM já gravados (texto → deflate) e devolve o espaço ao disco.
// Rodar com o serviço parado: node archive/compact.mjs
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "referencia-archive.sqlite");
const db = new DatabaseSync(dbPath);
const before = fs.statSync(dbPath).size;
const pick = db.prepare(`SELECT rowid r, payload_json p FROM archive_crm_entities WHERE typeof(payload_json)='text' LIMIT 2000`);
const upd = db.prepare(`UPDATE archive_crm_entities SET payload_json=? WHERE rowid=?`);
let n = 0;
for (;;) {
  const rows = pick.all(); if (!rows.length) break;
  db.exec("BEGIN"); for (const x of rows) upd.run(zlib.deflateSync(x.p), x.r); db.exec("COMMIT");
  n += rows.length; if (n % 20000 < 2000) console.log("comprimidos", n);
}
db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.exec("VACUUM");
console.log(`ok: ${n} registros; ${(before / 1e6).toFixed(0)} MB → ${(fs.statSync(dbPath).size / 1e6).toFixed(0)} MB`);
