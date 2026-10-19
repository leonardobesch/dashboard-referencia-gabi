import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,"..");
const cfgPath=path.join(here,"config.json");
const workerPath=path.join(project,"worker.js");

const cfg=JSON.parse(fs.readFileSync(cfgPath,"utf8"));
const pair=await webcrypto.subtle.generateKey(
  {name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]
);
const pkcs8=Buffer.from(await webcrypto.subtle.exportKey("pkcs8",pair.privateKey)).toString("base64");
const spki=Buffer.from(await webcrypto.subtle.exportKey("spki",pair.publicKey)).toString("base64");

cfg.archivePrivateKeyPkcs8=pkcs8;
delete cfg.archiveKey;
fs.writeFileSync(cfgPath,JSON.stringify(cfg,null,2));

let worker=fs.readFileSync(workerPath,"utf8");
if(!worker.includes("__ARCHIVE_PUBLIC_KEY__")){
  throw new Error("Worker public key placeholder not found");
}
worker=worker.replace("__ARCHIVE_PUBLIC_KEY__",spki);
fs.writeFileSync(workerPath,worker);
console.log("Archive signing keypair configured. Private key remains local; public key embedded in Worker.");
