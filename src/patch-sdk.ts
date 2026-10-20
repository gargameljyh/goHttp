import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const EXTENSIONLESS = /(\bfrom\s*|\bimport\s*\(\s*)'(\.\.?\/[^']+?)'/g;

function hasExtension(specifier: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(path));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

let done = false;

/**
 * 修复 @snowluma/sdk 发布包中无扩展名的相对导入（Node ESM 与 tsc NodeNext 均无法解析）。
 * 幂等：上游修复后此函数不做任何事。
 * 必须在首次 import 依赖 @snowluma/sdk 的模块（bot.js）之前调用，
 * 因为 postinstall 在作为依赖安装时可能被 npm 拦截，补丁只能放在启动时。
 */
export function patchSdkOnce(): void {
  if (done) {
    return;
  }
  done = true;

  let dist: string;
  try {
    const require = createRequire(import.meta.url);
    dist = join(dirname(require.resolve('@snowluma/sdk/package.json')), 'dist');
  } catch {
    console.warn('[patch] 未找到 @snowluma/sdk（依赖未安装？），跳过补丁');
    return;
  }

  let count = 0;
  try {
    for (const file of collectFiles(dist)) {
      const source = readFileSync(file, 'utf8');
      const fixed = source.replace(EXTENSIONLESS, (match, prefix: string, specifier: string) => {
        if (hasExtension(specifier)) {
          return match;
        }
        count += 1;
        return `${prefix}'${specifier}.js'`;
      });
      if (fixed !== source) {
        writeFileSync(file, fixed);
      }
    }
  } catch (error) {
    console.warn(
      '[patch] 补丁 @snowluma/sdk 失败:',
      error instanceof Error ? error.message : error,
    );
    return;
  }
  if (count > 0) {
    console.log(`[patch] 已修复 @snowluma/sdk 的 ${count} 处 ESM 导入`);
  }
}
