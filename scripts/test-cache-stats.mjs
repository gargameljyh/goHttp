import { loadConfig } from '../src/config.ts';
import { GlmClient } from '../src/glm.ts';

const config = loadConfig();
const glm = new GlmClient({
  ...config.glm,
  onUsage: (usage) =>
    console.log(`  → 输入 ${usage.promptTokens} tok，命中 ${usage.cachedTokens} tok`),
});

const systemPrompt = config.glm.systemPrompt;
for (let i = 1; i <= 2; i++) {
  const reply = await glm.chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '用一句话打个招呼就好' },
  ]);
  console.log(`第 ${i} 次回复: ${reply}`);
}
console.log('累计统计:', glm.getStats());
