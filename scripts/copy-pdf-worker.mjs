import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = path.join(
  root,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const targetDir = path.join(root, "public");
const target = path.join(targetDir, "pdf.worker.min.mjs");
const workerPolyfill = `if(typeof Promise.withResolvers!=="function"){const p=function(){let r,j;const promise=new Promise((res,rej)=>{r=res;j=rej});return{promise,resolve:r,reject:j}};try{Object.defineProperty(Promise,"withResolvers",{value:p,configurable:true,writable:true})}catch{Promise.withResolvers=p}}\n`;

if (!fs.existsSync(source)) {
  console.error(`Missing pdf worker source at ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const workerContent = fs.readFileSync(source, "utf8");
fs.writeFileSync(target, `${workerPolyfill}${workerContent}`, "utf8");
console.log(`Copied ${source} -> ${target}`);
