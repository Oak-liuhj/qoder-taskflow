import z from '@deepseek-ai/schemastery';

// 宿主配置边界；业务层只接收解析后的配置值。
export const Config = z.object({
  dataDir: z.string(), maxDepth: z.number().step(1).min(0).max(8).default(2),
  maxConcurrent: z.number().step(1).min(1).max(16).default(2), maxTasks: z.number().step(1).min(1).max(2000).default(200),
  autoPlan: z.boolean().default(true), quickReplies: z.boolean().default(true), provider: z.string().default('spawn'),
});
