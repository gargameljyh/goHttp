// @snowluma/sdk@2.0.3 的 dist 产物使用了无扩展名的相对导入，
// 纯 Node ESM 运行时和 tsc NodeNext 类型解析都无法接受。
// 本脚本在 npm install 后自动给 dist 内 .js/.d.ts 的相对导入补上 .js 扩展名。
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SDK_DIST = 'node_modules/@snowluma/sdk/dist';

const EXTENSIONLESS = /(\bfrom\s*|\bimport\s*\(\s*)'(\.\.?\/[^']+?)'/g;

function hasExtension(specifier) {
  return /\.[cm]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files;
}

let patched = 0;
for (const file of await collectFiles(SDK_DIST)) {
  const source = await readFile(file, 'utf8');
  const fixed = source.replace(EXTENSIONLESS, (match, prefix, specifier) => {
    if (hasExtension(specifier)) {
      return match;
    }
    patched += 1;
    return `${prefix}'${specifier}.js'`;
  });
  if (fixed !== source) {
    await writeFile(file, fixed);
  }
}

console.log(`[patch-snowluma-sdk] 补上 ${patched} 处相对导入的 .js 扩展名`);
