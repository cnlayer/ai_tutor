# 方案：基于 DeepSeek Harness（DSH）构建 AI 功课辅导助手

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1（方案评审稿） |
| 对应需求 | [AI功课辅导助手-MVP产品需求文档.md](./AI功课辅导助手-MVP产品需求文档.md) v0.2 |
| 核心命题 | 放弃自建 UI + 后端框架，把 ai_tutor 做成 DSH 之上的一个 **Cordis bundle（dsh-ai-tutor）**，DSH 充当产品运行时 |
| 事实依据 | 本方案的服务/插槽/包名均来自当前安装实例的实时探查（`cordis_inspect_*`）与官方包清单，非推测 |

---

## 1. 结论先行

**可行，而且大部分基础代码可以删掉。** DSH 不是"一个聊天框架"，它已经把本产品最难的部分做成了可插拔的运行时：

- **多模型网关**：`llm` 服务 + `@deepseek-ai/dsh-llm-pi-ai` 支持任意 OpenAI 兼容端点（`api: openai-completions` + `baseURL`）——**Ollama / LM Studio / vLLM 本地模型纯 YAML 配置即可接入**，满足 PRD"云端 + 本地混合配置"（FR7-1/7-8）；每个 provider 有独立 `retryPolicy`。
- **ASR（语音输入）**：`speechToText` / `speechController` 服务 + 实验包 `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`（**本地 SenseVoice ONNX 转写，数据不出家庭网络**）+ `dsh-experimental-client-ui-voice-input`（录音→草稿框可编辑文本→确认发送，**正是 FR3-1 的行为**）。
- **多模态附件**：`attachments` / `fileUploads` 服务 + 本地附件存储 + 消息图片渲染插槽——拍照提问的图片管道现成。
- **会话即历史**：事件溯源 Session（JSONL 持久化）+ workspace/会话树侧栏 + SQLite FTS5 全文搜索（`session-query-sqlite`）+ 会话恢复/追问 + compaction 长对话压缩——FR8 几乎零开发。
- **消息反馈**：`messageFeedback` 服务 + like/dislike UI 条（`dsh-message-feedback`）——FR5-6"懂了/没懂"、FR9-5"报个错"有现成底座。
- **数学公式**：`dsh-client-ui-primitives` 已依赖 KaTeX——FR6-1 公式渲染基本现成。
- **Agent 预设**：`agentPresets` 用 YAML 声明"这套会话是谁、能用哪些工具、注入什么提示词"——辅导人设、引导策略、工具白名单的产品核心，全部声明式落在这里。
- **编排**：`workflowEngine` + `subagents`（每次调用可覆盖 provider/model）——FR7-5 双模型交叉核对、后续日报等都是现成脚本原语。
- **部署形态**：`dsh` 常驻家庭设备，孩子用 Chrome/Edge/Safari 经局域网访问 Web UI——与 PRD 非功能需求"本地部署、浏览器访问"完全同构。

自建 Vue 前端 + Python 后端里，真正属于"产品差异化"的只有 4 块：**孩子档案、引导式辅导方法论（prompt/策略）、拍照题目的裁剪与确认交互、TTS 朗读**。其余都是 DSH 已经提供且质量更高的通用设施。

---

## 2. 需求 → DSH 能力映射表

> 图例：✅ 现成直接用 ｜ ⚙️ 纯配置 ｜ 🧩 小插件（bundle 内开发）｜ ⚠️ 有 gap，需取舍

| PRD 需求 | DSH 对应机制 | 等级 |
| --- | --- | --- |
| FR1-1 多孩子档案 | bundle Host 插件用 `storage.domain` 存档案；会话归属孩子（per-session projection） | 🧩 |
| FR1-2 首页三大入口 | `main` keyed slot 注册 `tutor-home` 面板 + 侧栏入口；或直接复用 Composer（文字/附件/语音三件已就位） | 🧩/✅ |
| FR1-3 学段适配 | 档案 → 会话上下文注入（`agent.inject` / 预设变量），随年级改变语言难度 | 🧩 |
| FR2 文字输入 | Composer 原生 | ✅ |
| FR3 语音输入 | voice-input 客户端包 + sensevoice 本地 ASR + `speechController` Remote | ✅⚙️ |
| FR4 图片输入 | 附件上传管道现成；**摄像头拍摄与框选裁剪**需自制 Client 控件（`conversation.input.attachments` / `conversation.input.left` 插槽） | 🧩 |
| FR4-3 提取确认 | 引导 agent 先复述题目再进入辅导（预设话术策略），配合"重新识别"快捷输入 | 🧩 |
| FR5 引导式辅导核心 | **Agent preset**：`dsh-persona` 声明辅导人格 + `ctx.systemPrompt.section()` 注入苏格拉底策略 + `tools.restrict()` 关掉无关工具；"连续 3 轮无进展建议切换完整讲解"由投影计数触发注入 | 🧩 |
| FR5-2 模式切换+后台记录 | 切换 = 会话级状态存 domain/projection + 写会话记录；无需新事件类型 | 🧩 |
| FR5-6 懂了/没懂 | `conversation.chat.assistant-actions` 注册两个按钮，落 `messageFeedback` | 🧩✅ |
| FR6-1 公式渲染 | KaTeX 已在 primitives 依赖中 | ✅ |
| FR6-2 朗读 TTS | DSH **无内置 TTS**。方案 a：浏览器 `speechSynthesis`（零后端，中英文可用，音质一般）；方案 b：仿 sensevoice 模式起 sherpa-onnx TTS 子进程做成 Host 服务。先 a 后 b | 🧩⚠️ |
| FR7-1/7-2 多模型+配置入口 | `dsh-llm-pi-ai` 多 provider YAML + 现成 Models 设置页（`settings.section`） | ✅⚙️ |
| FR7-4 自动切换备用模型 | `dsh-llm-retry` 兜同 provider；**跨 provider failover** 用 `agent/request-error` waterfall 写一个小路由（改选 provider 后 `next()` 重试） | 🧩 |
| FR7-5 交叉核对 | `workflowEngine` 脚本：agent(解答, model A) → agent(核对, model B) → 分歧仲裁；或 Host 工具 `cross_check` 内直调 `ctx.llm.stream` | 🧩 |
| FR7-6 用量上限 | `tokenMeter` / sessionStats 投影 + `llm/stream` waterfall 拒绝超限会话并注入温和提示 | 🧩 |
| FR8 会话历史/回放/追问 | Session + workspace 侧栏 + FTS 搜索 + resume | ✅ |
| FR9 内容安全 | preset 人格约束 + `tools.guard()` 硬拦危险工具（孩子会话根本看不到 bash/edit 等） | 🧩✅ |
| FR9-4 数据声明 | `settings.onboarding` / hero 区注册声明卡；本地部署 + 本地 ASR 天然减少出户数据 | 🧩 |
| 部署者口令保护 | DSH Web 有整站 auth token；**"孩子防误入设置页"粒度较粗**，是已知取舍点（见 §6） | ⚠️ |

---

## 3. 目标架构

```
┌─ 家庭设备（常开）────────────────────────────────────────────┐
│  dsh --profile ai-tutor   （专属 profile，与你的开发 profile 隔离）│
│                                                            │
│  Host（Cordis 组合）                                        │
│  ├─ dsh-web-app / api-* / session / agent-loop   （底座，现成）│
│  ├─ dsh-llm-pi-ai        ← 云端 DeepSeek ▤ OpenAI 兼容网关      │
│  ├─ dsh-llm-retry + tutor-failover（小插件）  → Ollama/LMStudio │
│  ├─ dsh-experimental-speech-to-text(-sensevoice)  本地 ASR    │
│  ├─ dsh-message-feedback / session-query-sqlite / storage …  │
│  └─ dsh-bundle-ai-tutor  ★ 本产品唯一要新写的包                │
│      ├─ host:  tutor-core    孩子档案 domain、模式切换记录、     │
│      │                       学段注入、failover、限额、cross_check │
│      ├─ host:  tutor-persona 系统提示 section / skill 注册      │
│      ├─ client: tutor-home   首页大按钮面板（main slot）         │
│      ├─ client: tutor-child  档案选择器（composer dock）        │
│      ├─ client: tutor-voice  拍照裁剪/朗读按钮（assistant-actions│
│      │                        + input.left 插槽）              │
│      ├─ preset: ai-tutor.yaml 引导式人格 + 工具白名单            │
│      ├─ skills: socratic-math / vocab-card / english…          │
│      └─ workflows: cross-check / weekly-report（脚本文件）      │
└────────────────────────────────────────────────────────────┘
        ↕ Remote(RPC)/附件上传/语音流  （局域网，auth token）
   孩子平板/电脑浏览器  ＋  家长浏览器（同页，设置区在 Settings）
```

要点：

1. **bundle 是交付物**。一个 npm 包（workspace 内开发，`plugin_manager.install_bundle` 装入 `ai-tutor` profile），带 `cordis.patch.yml` 声明自己依赖的 Host/Client 行——孩子 profile 只装这个 bundle + 底座，**看不到任何开发者界面**。
2. **preset 是产品灵魂**。"引导优先/年龄适配/内容安全"这些 PRD 原则写成 `ai-tutor` preset：persona + system prompt 段落 + `tools.restrict` 白名单（保留 read_image / web_search / ask_user_question / present，砍掉 bash/write/edit/ssh 等一切开发工具）。会话默认挂载该 preset（`conversation.hero.agentPreset` 可锁定默认）。
3. **数据全走 DSH 的地盘规则**：孩子档案、模式切换等业务状态放 `storage.domain`（schema 校验 + `domain/changed` 事件）与会话投影（projection，可 `wire.view` 直达前端），**不自造 session 事件类型**——这是 practices.md 的升级安全红线。

---

## 4. 相关工作流（两层含义）

### 4.1 产品内工作流（workflow 脚本，跑在 `workflowEngine`）

| 工作流 | 内容 | 对应需求 |
| --- | --- | --- |
| `cross-check` | 解答模型 A → 独立复核模型 B → 分歧则仲裁/提示"建议再检查"（FR7-5）；可用便宜本地模型做复核、云端强模型做解答，成本可控 | FR7-5 |
| `solve-board` | 几何/函数题：解题 agent 产出 LaTeX + SVG/函数图像描述 → 由渲染卡片展示（FR6-4 基线先走"模型生成 SVG/描述图"路线） | FR6-4 |
| `weekly-report`（V1.1） | `dsh-schedule` 定时唤醒会话 → `session-query` FTS 拉各孩子会话 → 汇总"懂了率、切换次数、提问轮次"写 Markdown 到 workspace，家长直接看 | §7 指标、FR5-2 记录消费 |
| `mistake-notebook`（V1.2） | 会话结束钩子提取错题 → 归档 `错题本/<孩子>/<学科>.md` | 版本路线 |

北极星指标（独立完成辅导数）等统计**不需要新数据库**：session 日志 + `sessionStats` 投影 + FTS 就是数据仓库。

### 4.2 开发工作流（本项目自身的迭代方式）

- 就在 **DSH 里开发 DSH 插件**：本会话所在的 harness 自带 `cordis-plugin-development` / `editing-cordis-compositions` skill、`cordis_inspect_*` 实时探查 API、`plugin_manager` 安装通道与 Client HMR——写→装→页面热更的循环已在本环境跑通（本次调研即为例证）。
- `ai_tutor` 仓库形态变为：`dsh-bundle-ai-tutor/`（bundle 源码）+ `presets/ai-tutor.yaml` + `workflows/*.js` + `skills/`，pnpm 工作区，`dsh --profile ai-tutor` 起孩子端，开发 profile 装全套调试工具。
- prompt 工程（原 `backend/app/core/prompt_engine.py`）迁移为 preset YAML + skills 目录——**可读 diff、可版本化、无需改代码即可迭代话术**，比藏在 Python 字符串里更好。

---

## 5. 现有代码的去留

| 现有资产 | 处置 |
| --- | --- |
| `backend/app/services/asr.py` | **删** → sensevoice 本地 ASR 包 |
| `backend/app/api/sessions.py` / `events.py` / SSE | **删** → DSH Session + Remote 流 |
| `backend/app/api/children.py` + DB 表 | **薄迁移** → `storage.domain` 十几行代码 |
| `backend/app/core/prompt_engine.py` | **迁移** → preset + skills（内容保留，载体换掉） |
| `backend/app/services/tts.py` | 保留思路 → 方案 a 浏览器 TTS 先行，方案 b sherpa-onnx 插件后补 |
| `backend/app/api/files.py` | **删** → attachments/fileUploads 管道 |
| `frontend/*`（Vue 全站） | **退役或降级**（见 §6 路线 B） |
| `deploy/backup.*` | 保留，路径指向 `$DSH_HOME`（session JSONL + domain 存储 + 附件目录即全部用户数据） |
| AdminModelsPage | **删** → DSH 自带 Models 设置页 |

粗估：**通用设施代码归零，自研代码量降到原前后端总和的 1/4～1/3**，且都在 DSH 的插槽/声明机制内，升级冲击面小。

---

## 6. 风险、取舍与逃生门

| 风险 | 评估 | 对策 |
| --- | --- | --- |
| **儿童友好度**：DSH 是开发工具气质，侧栏/设置对 6–9 岁偏复杂（威胁"≤3 步""凭图标找到入口"验收） | 最大产品风险 | 专属 profile 只装 tutor bundle；用 `sidebar`/`main` single-slot 覆盖做"孩子壳"（大图标首页 + 精简侧栏）；hero 品牌位替换。**M0 就让孩子实测**，复杂度不达标再走路线 B |
| 权限粒度：孩子误入 Settings（改模型） | 中 | Web 整站 auth token + 孩子设备用受限入口；"设置口令"是 DSH 未提供的细粒度能力，列为已知 gap，可在 bundle 的 settings 覆盖层里自制口令门 |
| TTS 音质/儿童语速 | 中 | 浏览器 speechSynthesis 起步（iPad Safari 支持中英）；不满意则 sherpa-onnx TTS Host 插件（模式与 sensevoice 包相同，可行） |
| DSH 迭代快、内部 API 变动 | 中 | 只用插槽系统 + 公开 Service/Event 目录（本次探查确认）+ Config；遵守 practices.md 红线（不写 DOM、不造事件类型、投影代替扫描）；bundle 版本与 profile 锁定 |
| 本地模型辅导质量 | 与自建方案相同，非新增风险 | FR7-4 failover 小插件 + 混合配置本来就要求 |

**逃生门（路线 B）**：若孩子端最终证明必须完全自定义 UI，DSH 的 **Remote JSON-RPC / `dsh-acp` / SDK stdio 服务**就是现成的后端 API——保留一个极薄的 Vue 壳（只画聊天界面和大按钮）直连 DSH 会话即可。**先走路线 A（全内置），路线 B 只保留一个壳的可能性**。两条路线共享同一个 bundle 内核（tutor-core/preset/workflows），不存在推倒重来。

---

## 7. 实施路线图

| 里程碑 | 内容 | 工作量估计 |
| --- | --- | --- |
| **M0 纯配置验证**（半天～1 天） | 建 `ai-tutor` profile：装 voice-input bundle + sensevoice；`dsh-llm-pi-ai` 配云端+本地双通道；写第一版 `ai-tutor` preset（纯提示词）；**孩子用原生 UI 试问 10 题**，验证 ASR/图片/公式/双模型 | 零代码 |
| **M1 bundle 骨架**（2–3 天） | `dsh-bundle-ai-tutor` 首版：孩子档案 domain + 选择器 + 学段注入 + 模式切换记录 + "懂了/没懂"动作 + 浏览器 TTS 朗读 + failover 小插件；安装即用 | 🧩 核心 |
| **M2 交互定制**（3–5 天） | 首页 `tutor-home` 面板（三入口大按钮）、拍照裁剪确认卡、solved 检查点、cross-check workflow、数据声明页/首次引导 | 🧩 UI |
| **M3 指标与守护**（2–3 天） | 限额、切换占比/懂了率统计投影 + 侧栏徽标、weekly-report 工作流、backup 脚本对接 | 收尾 |

每步都通过 `install_bundle` 落进 profile、热更验证——迭代节奏与现在这份 PRD → 代码 → 手测的循环相比，是数量级的差别。

---

## 8. 建议

1. **采纳本方向**：把 ai_tutor 重定位为"DSH 上的一个 bundle + preset + workflows"，停止在自建前后端上继续投入（现 MVP 代码转入只读参考）。
2. **先跑 M0**：全程不写代码，就能拿孩子的真实反馈回答 PRD 三个验证问题里最贵的一个（"孩子愿不愿用原生交互"），再决定路线 A 收尾还是启用路线 B 逃生门。
3. 值得立刻做的验证细节：SenseVoice 对**儿童吐字**的识别率（PRD 风险表第 3 条）、本地 Ollama 模型在三年级应用题上的引导质量、KaTeX 在平板上的渲染表现。
