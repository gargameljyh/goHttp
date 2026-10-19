import { loadConfig } from './config.js';
import { runBot } from './bot.js';

const config = loadConfig();

const maskedKey = config.glm.apiKey
  ? `${config.glm.apiKey.slice(0, 6)}...${config.glm.apiKey.slice(-4)}`
  : '(未配置)';

console.log(`[app] SnowLuma: ${config.snowluma.wsUrl}`);
console.log(`[app] GLM 模型: ${config.glm.model} | API Key: ${maskedKey}`);

runBot(config).catch((error) => {
  console.error('[app] 运行失败:', error);
  process.exitCode = 1;
});
