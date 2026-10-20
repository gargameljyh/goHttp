import { loadConfig } from '../src/config.ts';
import { createLlmClient } from '../src/llm/index.ts';

const config = loadConfig();
const llm = createLlmClient({
  ...config.llm,
  onUsage: (usage) =>
    console.log(`  → 输入 ${usage.promptTokens} tok，命中 ${usage.cachedTokens} tok`),
});

const systemPrompt = config.llm.systemPrompt;
for (let i = 1; i <= 2; i++) {
  const reply = await llm.chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '用一句话打个招呼就好' },
  ]);
  console.log(`第 ${i} 次回复: ${reply}`);
}
console.log('累计统计:', llm.getStats());
