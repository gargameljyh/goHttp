#!/usr/bin/env node
import { loadConfig } from './config.js';
import { patchSdkOnce } from './patch-sdk.js';

// 必须在加载 bot.js（依赖 @snowluma/sdk）之前修补 SDK 的 ESM 导入
patchSdkOnce();
const { runBot } = await import('./bot.js');

const config = loadConfig();

const maskedKey = config.llm.apiKey
  ? `${config.llm.apiKey.slice(0, 6)}...${config.llm.apiKey.slice(-4)}`
  : '(未配置)';

console.log(`[app] SnowLuma: ${config.snowluma.wsUrl}`);
console.log(
  `[app] LLM: ${config.llm.provider} (${config.llm.protocol}) | 模型: ${config.llm.model} | ${config.llm.baseUrl} | API Key: ${maskedKey}`,
);

runBot(config).catch((error) => {
  console.error('[app] 运行失败:', error);
  process.exitCode = 1;
});
