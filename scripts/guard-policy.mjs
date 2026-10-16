// 离线自检：打印 guard 注入到每次模型调用的「家长监护」提示段（含两份白名单与路由规则）。
//
// 用法：
//   node scripts/guard-policy.mjs                  # 用默认配置
//   node scripts/guard-policy.mjs my-guard.json    # 用一份家长配置（JSON，字段同 patch 里 ai-tutor-guard 的 config）
//
// 改完白名单或路由文案后先跑这里看模型实际读到的指令，再去界面上测。
// JSON 会经 guard 的 Config 校验：字段名写错会报 issues，不会静默忽略。
import { readFileSync } from 'node:fs';
import { Config, buildPolicy } from '../dsh-ai-tutor-guard/index.js';

const configPath = process.argv[2];
const plain = configPath ? JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) : {};

const { value, issues } = await Config['~standard'].validate(plain);
if (issues) {
  console.error('配置校验失败：', JSON.stringify(issues, null, 2));
  process.exit(1);
}
console.log(configPath ? `--- ${configPath} ---` : '--- 默认配置 ---');
console.log(buildPolicy(value));
