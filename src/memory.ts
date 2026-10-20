import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LlmClient } from './llm/index.js';

/** 一条长期记忆：关于某个用户（user）或某个群（group）的一句话事实 */
export interface MemoryEntry {
  id: string;
  scope: 'user' | 'group';
  ref: number;
  content: string;
  createdAt: string;
  hits: number;
}

/** 当前对话的记忆归属：说话人 + 所在群（私聊为 null） */
export interface MemoryRefs {
  userRef: number;
  groupRef: number | null;
}

export interface MemoryStoreConfig {
  dir: string;
  maxPerUser: number;
}

/** 中文按 2 字滑窗、英文数字按词，生成用于粗粒度相似度的字符集合 */
export function textGrams(text: string): Set<string> {
  const grams = new Set<string>();
  const normalized = text.toLowerCase();
  for (const match of normalized.matchAll(/[a-z0-9]+/g)) {
    if (match[0]) grams.add(match[0]);
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 1 < run.length; i++) {
      grams.add(run.slice(i, i + 2));
    }
    if (run.length === 1) {
      grams.add(run);
    }
  }
  return grams;
}

/** 重叠系数：0（无关）~ 1（高度相似） */
export function similarity(a: string, b: string): number {
  const gramsA = textGrams(a);
  const gramsB = textGrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) {
      overlap += 1;
    }
  }
  return overlap / Math.min(gramsA.size, gramsB.size);
}

/** 基于文件的记忆库：JSONL 持久化，进程内全量缓存（量级小，读写整文件即可） */
export class MemoryStore {
  private readonly file: string;
  private readonly maxPerScope: number;
  private entries: MemoryEntry[] = [];

  constructor(config: MemoryStoreConfig) {
    this.file = join(resolve(process.cwd(), config.dir), 'memories.jsonl');
    this.maxPerScope = config.maxPerUser;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) {
      return;
    }
    for (const line of readFileSync(this.file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const entry = JSON.parse(trimmed) as MemoryEntry;
        if (entry && typeof entry.content === 'string' && entry.content && Number.isFinite(entry.ref)) {
          this.entries.push(entry);
        }
      } catch {
        // 跳过损坏行
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
    renameSync(tmp, this.file);
  }

  /** 新增一条记忆；与同对象已有记忆高度相似时视为重复，返回 false */
  add(scope: 'user' | 'group', ref: number, content: string): boolean {
    const clean = content.trim().slice(0, 200);
    if (!clean || !Number.isFinite(ref)) {
      return false;
    }
    const duplicate = this.entries.some(
      (entry) =>
        entry.scope === scope && entry.ref === ref && similarity(entry.content, clean) >= 0.7,
    );
    if (duplicate) {
      return false;
    }
    this.entries.push({
      id: randomUUID(),
      scope,
      ref,
      content: clean,
      createdAt: new Date().toISOString(),
      hits: 0,
    });
    this.evictOverCap(scope, ref);
    this.save();
    return true;
  }

  /** 单个对象记忆超上限时，淘汰命中最少且最旧的 */
  private evictOverCap(scope: 'user' | 'group', ref: number): void {
    const sameScope = this.entries.filter((entry) => entry.scope === scope && entry.ref === ref);
    const excess = sameScope.length - this.maxPerScope;
    if (excess <= 0) {
      return;
    }
    sameScope.sort(
      (a, b) => a.hits - b.hits || Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    const dropIds = new Set(sameScope.slice(0, excess).map((entry) => entry.id));
    this.entries = this.entries.filter((entry) => !dropIds.has(entry.id));
  }

  private inScope(entry: MemoryEntry, refs: MemoryRefs): boolean {
    return (
      (entry.scope === 'user' && entry.ref === refs.userRef) ||
      (entry.scope === 'group' && refs.groupRef !== null && entry.ref === refs.groupRef)
    );
  }

  /** 检索与当前提问相关的记忆（只检索当前说话人/所在群的，避免跨用户泄露） */
  search(query: string, refs: MemoryRefs, limit: number): MemoryEntry[] {
    const now = Date.now();
    const scored = this.entries
      .filter((entry) => this.inScope(entry, refs))
      .map((entry) => {
        const score =
          2 * similarity(entry.content, query) + 0.5 / (1 + (now - Date.parse(entry.createdAt)) / 86_400_000);
        return { entry, score };
      })
      .filter((item) => item.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (scored.length > 0) {
      for (const item of scored) {
        item.entry.hits += 1;
      }
      this.save();
    }
    return scored.map((item) => item.entry);
  }

  /** 删除当前对话范围内与关键词匹配的记忆，返回删除条数 */
  removeMatching(keyword: string, refs: MemoryRefs): number {
    const target = keyword.trim();
    if (!target) {
      return 0;
    }
    const dropIds = new Set(
      this.entries
        .filter(
          (entry) =>
            this.inScope(entry, refs) &&
            (entry.content.includes(target) || similarity(entry.content, target) >= 0.4),
        )
        .map((entry) => entry.id),
    );
    if (dropIds.size === 0) {
      return 0;
    }
    this.entries = this.entries.filter((entry) => !dropIds.has(entry.id));
    this.save();
    return dropIds.size;
  }

  /** 列出当前对话范围内的记忆（按命中与新旧排序），用于 /memories 命令 */
  list(refs: MemoryRefs, limit = 10): MemoryEntry[] {
    return this.entries
      .filter((entry) => this.inScope(entry, refs))
      .sort((a, b) => b.hits - a.hits || Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }
}

// ─── LLM 自动提取 ────────────────────────────────────────────────────────────

const EXTRACT_SYSTEM_PROMPT = `你是 QQ 聊天机器人的记忆提取器。从对话中提取值得机器人长期记住的信息，例如：用户的称呼或名字、喜好和讨厌的东西、重要的个人事实、与机器人或他人的约定、正在进行的事情。
要求：
- 每条记忆一句话，简明客观，用第三人称
- scope 取 "user"（关于说话人个人的信息）或 "group"（关于整个群的话题、约定或事件）
- 不要提取寒暄、玩笑、没有具体信息的闲聊
- 没有值得记住的信息就输出 []
只输出 JSON 数组，不要输出任何其他内容，格式：
[{"scope":"user","content":"……"}]`;

export interface ExtractedMemory {
  scope: 'user' | 'group';
  content: string;
}

/** 从一批对话轮次中提取记忆；失败时静默返回空数组，绝不影响主流程 */
export async function extractMemories(
  llm: LlmClient,
  exchanges: ReadonlyArray<{ user: string; assistant: string }>,
  refs: MemoryRefs,
): Promise<ExtractedMemory[]> {
  if (exchanges.length === 0) {
    return [];
  }
  const dialogue = exchanges.map((x) => `用户: ${x.user}\n机器人: ${x.assistant}`).join('\n');
  const raw = await llm.chat([
    { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `说话人QQ号: ${refs.userRef}\n群号: ${refs.groupRef ?? '私聊'}\n\n最近对话:\n${dialogue}`,
    },
  ]);
  return parseExtracted(raw, refs);
}

/** 宽容解析模型输出：剥掉代码围栏、截取首个 [ 到最后一个 ]，逐项校验 */
export function parseExtracted(raw: string, refs: MemoryRefs): ExtractedMemory[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const result: ExtractedMemory[] = [];
  for (const item of parsed) {
    const obj = item as Record<string, unknown>;
    const content = typeof obj?.content === 'string' ? obj.content.trim().slice(0, 200) : '';
    if (!content) {
      continue;
    }
    const scope = obj?.scope === 'group' && refs.groupRef !== null ? 'group' : 'user';
    result.push({ scope, content });
  }
  return result.slice(0, 10);
}
