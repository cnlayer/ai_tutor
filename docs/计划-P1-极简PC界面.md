# P1 开发计划：ai_tutor 极简 PC 浏览器界面

> 前置：M0 已验收（`ai-tutor` preset 可选、语音/图片/LaTeX 可用、教学效果初步正面）。
> 本文所有技术结论均已在当前 dsh 0.2.0-rc.2 安装上实测确认（Config schema、Slot 树、发行 patch）。

## 1. 目标与非目标

**目标（P1）**
- 一个"打开就是聊天框"的 PC 浏览器入口：无侧边栏、无轨迹页、无工作区选择、无技能中心、无插件入口。
- 新会话默认即 `ai-tutor` preset，孩子看不到也切不走模式选择器。
- 不展示模型思考链过程（进行中与完成后都不展示）。
- 保留孩子需要的能力：语音输入、拍照/贴图提问、LaTeX 渲染、引导式讲解。
- 保留家长需要的最小能力：模型切换、主题/语言设置。

**非目标（P1 不做）**
- 手机/平板 APP（P2，见 §7）。
- 自研整套壳层（重写 AppFrame）——风险高、升级脆弱，P1 用官方壳 + 裁剪。
- 工具权限收紧（M1 的 `ctx.tools.restrict`）——但见 §6 风险 R3，建议 P1.3 前合并。

## 2. 总体架构决策

### D1：独立 profile `ai-tutor`，独立端口
```powershell
dsh ai-tutor --from-default-profile web   # 从出厂 web 模板创建新 profile
dsh ai-tutor --port 3090                  # 与开发 profile(3080) 并行运行
```
- profile = patch 层栈 + 独立存储/会话域：孩子的会话、设置与开发环境完全隔离。
- 语音模型缓存在 `DSH_HOME`（`C:\Users\BLW\.dsh\speech-to-text`）跨 profile 共享，不会重复下载 239MB。
- 开发 profile（3080）保持现状，随时可回退验证。

### D2：两个 workspace bundle
| bundle | 内容 | 安装到 |
|---|---|---|
| `@local/dsh-ai-tutor`（已有） | preset 定义（persona + 工具面） | web 与 ai-tutor 两个 profile |
| `@local/dsh-ai-tutor-kid`（新建） | UI 裁剪 patch（行禁用 + 默认 preset + chat 配置）+ 客户端插件（CSS 瘦身、"新对话"按钮、品牌替换） | 仅 ai-tutor profile |

bundle 是 pnpm link 安装：改文件后 `plugin_manager set_bundle` 关→开即生效，迭代成本低。

### D3：默认 preset（已实测 schema）
`agent-preset-registry` 的 config：`default`（必填 string）、`selectedDefault`（volatile，用户默认）。
kid bundle patch 覆盖该行：
```yaml
- id: agent-preset-registry
  config:
    default: ai-tutor
```
新 profile 存储干净，无 `selectedDefault` 残留，`default` 直接生效。同时禁用 `ui-agent-preset` 客户端行 → hero 的模式选择器消失，孩子无法切换 preset。

### D4：壳层裁剪 = 功能行禁用 + CSS 隐藏列（已实测）
- `dsh-client-ui-layout` **没有任何 config**（实测 status: absent），AppFrame 始终挂载三列容器（README 原文："AppFrame keeps the column containers mounted"）。
- 直接禁用 `ui-sidebar` 行会连带删掉它声明的 `sidebar.workspaces`/`sidebar.sessions` 等子 slot，导致 `ui-workspace`/`ui-session` 注册失败；且列容器仍在，留白 280px。
- 因此：**保留壳层行（ui-layout / ui-sidebar），用 kid 客户端插件注入 CSS 隐藏侧边栏列**；"新对话"入口改注册到会话头部 slot（见 §4 Spike B）。CSS 集中在一个插件文件里，升级时单点修复。

## 3. 行禁用清单（kid bundle 的 cordis.patch.yml）

**禁用**（行 id 来自出厂 `dsh-web-app/cordis.patch.yml`，已逐行核对）：

| 类别 | 行 id |
|---|---|
| 轨迹 | `ui-trajectory` |
| 工作区 | `ui-workspace`, `ui-directory-picker-browse`, `ui-directory-picker-native` |
| 技能中心 | `ui-skill` |
| 编码代理功能 | `ui-goal`, `ui-jobs`, `ui-plan`, `ui-deliverables`, `ui-workflow-run`, `ui-subagent`, `ui-subagent-model-selection`, `ui-schedule`, `ui-reference` |
| 桌面/导出 | `ui-session-log-download`, `ui-open-in-app` |
| 插件管理 | `ui-plugin-manager`, `ui-settings-plugins`, `ui-settings-plugin-inventory` |
| 模式/权限选择器 | `ui-agent-preset`, `ui-permission`（见 R3） |
| 右侧栏 | `ui-sidebar-right`, `ui-sidebar-documentpreview`, `ui-sidebar-files`, `ui-sidebar-terminal` |

**保留**：`ui-layout`、`ui-sidebar`（壳层，CSS 隐藏）、`ui-renderer`、`ui-web`、`ui-conversation`、`ui-chat`（config `transcriptView: compact`）、`ui-session`、`ui-approval`、`ui-attachment`、`ui-voice-input`、`ui-model-selection`（家长）、`ui-input-trigger`、`ui-commands`、`ui-message-feedback`、`ui-theme`、`ui-settings*`（通用/主题/键盘）、`llm-*`、`speech-*`、`preset-ai-tutor`、`agent-preset-registry`。

## 4. 两个技术 Spike（P1.0，先在开发 profile 用 `--patch` 覆盖层验证，可逆）

### Spike A：隐藏思考链
已确认事实：`ui-chat` config 只有 `transcriptView`（compact/standard/detailed/verbose）/`performanceUsage`/`linkOpening`；四种模式只**折叠**过程，不隐藏。`conversation.chat.node` 是 keyed slot，keyDomain 含 `turn-process`（过程组）与 `assistant-step`（assistant 渲染器内部用 `groupPart` 区分 reasoning/response）。

- **A1**：设 `transcriptView: compact`，观察完成轮与进行中的 reasoning 预览是否仍可见。
- **A2′**（Q1 已定：保留工具活动行，故不能用空渲染器一刀切）：实测 Chat DOM，确认 reasoning 预览行与完成轮 reasoning 折叠行是否为独立可寻址节点；若是 → kid 插件 CSS 精确隐藏这些行（工具行不动）；若 reasoning 与工具行混在同一节点内 → 注册自定义 `turn-process`/`assistant-step` 渲染器，复用官方子渲染并过滤 reasoning 段（重路径，实测后再定）。
- **A3**（兜底）：更宽泛的 CSS 行类名隐藏（升级最脆弱，仅作最后手段）。

### Spike B：壳层瘦身与入口补偿
- **B1**：CSS 隐藏侧边栏列与折叠 rail；验证拖拽把手、右列、`--dsh-frame-top-clearance` 无副作用。
- **B2**：向 `conversation.session.header.actions`（或 `.corner`）注册"新对话"按钮；实现前读 skill 的 `references/user-actions.md`，复用官方 New Session 流程（显式 workspace → 当前会话 workspace → 最近 workspace）。
- **B3**：品牌替换：`sidebar.brand.mark`/`sidebar.brand.name` + `conversation.hero.brand.mark` 注册 ai_tutor 图标与名称（替换"探索未至之境"官方品牌）。

## 5. 里程碑（合计约 2.5 人日）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **P1.0**（0.5d） | Spike A/B 在开发 profile 验证（`--patch` 覆盖层，不装 bundle） | 拿到 A2/B1/B2 的确定实现路径 |
| **P1.1**（0.5d） | `@local/dsh-ai-tutor-kid` bundle 落地，装进开发 profile 走查 | 3080 上出现极简形态，可一键禁用回退 |
| **P1.2**（0.5d） | 创建 `ai-tutor` profile：复制模型 provider 配置（zion/bailian + agent-default-model）、装两个 bundle、`--port 3090`；确认 first-use 默认工作区（Host 策略为 Documents 下自动创建；固定到指定目录为待查项） | 3090 打开即纯对话，新会话默认"AI 功课辅导" |
| **P1.3**（0.5d） | 孩子实测 10 题（语音/拍照/LaTeX/引导质量），家长流程（设置→模型切换） | §8 清单全绿 |
| **P1.4**（0.5d） | 打磨：欢迎语（`ui-settings-general.welcomeNoticeVersion`/hero 文案）、明暗主题、错误提示、使用说明一页 | 孩子无引导能独立完成一次作业问答 |

## 6. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| R1 | CSS 隐藏列对 dsh 升级脆弱 | 集中在 kid bundle 单文件；profile 锁 dsh 版本；升级时只查一处 |
| R2 | reasoning 与工具活动行可能混在同一 DOM 节点，CSS 无法精确只隐藏前者 | P1.0 实测 Chat DOM 后二选一：CSS 精确过滤 or 自定义渲染器过滤 reasoning 段（A2′） |
| R3 | 禁用 `ui-permission` 后会话用默认权限；preset 目前仍含 write/edit | P1.3 前把 M1 的 `ctx.tools.restrict()` 小插件并入 preset（去掉 write/edit），权限风险即消除 |
| R4 | 新 profile 首用工作区落在 Documents 自动目录 | 实测确认；如需固定目录，查 `dsh-workspace` 配置/预建 workspace（P1.2 内解决） |
| R5 | 双 host 并行（3080/3090）浏览器信任围栏 | 需要时用 `--trusted-host`；两 profile 存储独立互不影响 |
| R6 | 客户端插件改动需刷新页面（无 dev:web watcher 时 HMR 不生效） | 验收一律"关→开 bundle + 刷新"流程 |

## 7. P2 展望（手机/平板，暂不排期）
- **P2.0 spike**：平板浏览器直接开 `:3090`——壳层 <1024px 自动折叠，先评估触屏/软键盘/拍照上传的真实可用性。
- 路线 A（低成本）：PWA 化（manifest + 图标 + 触屏优化），复用同一 profile。
- 路线 B（重投入）：原生 APP 走 Remote JSON-RPC 协议自绘 UI。
- 决策依据 = P2.0 报告；孩子若主要用平板，P2 优先级提前。

## 8. P1 验收清单（DoD）
- [ ] `http://127.0.0.1:3090` 打开即纯对话；新会话默认"AI 功课辅导"（persona 自我介绍验证）
- [ ] 无侧边栏、无轨迹页、无工作区选择、无技能中心、无插件/模式/（视 R3）权限入口
- [ ] 思考链不展示：进行中的 reasoning 预览与完成轮的过程行均不可见（或按 Q1 决策仅保留工具活动）
- [ ] 语音、拍照提问、LaTeX、网页搜索正常；"新对话"按钮可用
- [ ] 家长可在设置里切换模型/主题；孩子无法进入开发类功能
- [ ] 开发 profile（3080）完全不受影响

## 已定决策（2026-10-15 用户确认）
- **Q1 = 保留工具活动行**：只隐藏推理文本（进行中的 reasoning 预览 + 完成轮的 reasoning 折叠行），"正在搜索网页/正在读文件"等工具活动行保留。→ Spike A 采用"过滤 reasoning、保留 tool 行"的实现路径（见 A2′）。
- **Q2 = 模型选择器保留可见**：`ui-model-selection` 行保留在输入区右下角，家长可直接切模型，不做家长门。
- **Q3 = 品牌名用"AI 功课辅导"**：与 preset 名称一致；B3 替换 `sidebar.brand.mark/name` 与 `conversation.hero.brand.mark`。
