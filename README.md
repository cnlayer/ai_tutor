# AI 功课辅导（ai_tutor）

基于 [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) 构建的孩子作业辅导应用。不写一行后端代码：整个产品是 DSH 之上的 **Cordis 组合层** —— 一个 agent preset + 一个界面瘦身/相机插件 + 一个 profile。

v1.0 能力（PC 浏览器，`http://127.0.0.1:3090`）：

- 默认进入「AI 功课辅导」preset：引导式辅导人格（不直接报答案，给台阶式提示）
- 极简对话界面：无侧边栏 / 无轨迹页 / 无工作区选择 / 无技能中心，隐藏思考链文本（保留工具活动行）
- **拍照提问**：输入框 📷 按钮 → 摄像头实时预览 → 拍后编辑（红圈圈出热点区域、剪切裁剪）→ 图片走原生附件管线进入对话
- 语音输入（DSH 官方 voice bundle）

v1.1 新增：

- **家长监护**（`dsh-ai-tutor-guard`）：家长定义允许的话题白名单（默认仅作业辅导）+ 禁区关键词硬拦截；Web 设置页表单或 profile patch 编辑，见 [docs/家长监护.md](docs/家长监护.md)

## 目录结构

```
dsh-ai-tutor/          # @local/dsh-ai-tutor：agent preset 声明（人格 + 工具白名单）
dsh-ai-tutor-kid/      # @local/dsh-ai-tutor-kid：孩子端客户端插件（界面瘦身 CSS + 相机/编辑）
dsh-ai-tutor-guard/    # @local/dsh-ai-tutor-guard：家长内容监护（话题白名单 + 禁区拦截）
docs/                  # 产品需求与方向/计划文档
```

## 运行前提

1. 安装 DSH：`npm i -g @deepseek-ai/dsh`（本仓库开发时使用 0.2.0-rc.2）
2. 创建独立 profile（不污染默认 `web` profile）：

```powershell
# 从默认 web profile 复制配置骨架
dsh ai-tutor --from-default-profile web --dump-config
# 把本仓库三个包安装进 profile（link: 依赖，改动后重启即生效）
dsh plugin --profile ai-tutor add ./dsh-ai-tutor
dsh plugin --profile ai-tutor add ./dsh-ai-tutor-kid
# guard 有 npm 依赖（@deepseek-ai/schemastery），link: 不会代装，先装一次
cd dsh-ai-tutor-guard && npm install && cd ..
dsh plugin --profile ai-tutor add ./dsh-ai-tutor-guard
```

3. 在 `~/.dsh/profiles/ai-tutor/cordis.patch.yml` 配置模型 provider（支持视觉的模型用于拍照提问）。
4. 启动：

```powershell
dsh ai-tutor --port 3090 --no-open
```

终端会打印带 token 的 URL，浏览器打开即可。

## 工作原理

- **preset**（`dsh-ai-tutor/cordis.patch.yml`）：向 `agent-preset-registry` 注册 `ai-tutor` preset（引导式辅导人格 + fs/web/ask-user 工具），profile 层将其设为默认。
- **界面瘦身**（`dsh-ai-tutor-kid/cordis.patch.yml`）：disable 无关 UI 行（轨迹、技能、工作区选择等），但保留 `ui-workspace`、`ui-sidebar-right`、`ui-plugin-manager` 挂载——它们是在其他插件 boot 期被解析的依赖，卸载会导致启动失败；入口 UI 用 CSS 后缀选择器隐藏。
- **相机插件**（`dsh-ai-tutor-kid/client.js`）：React 组件注册进官方槽位 `conversation.input.left`（list 槽，注册需 `id`）；`getUserMedia` 预览（127.0.0.1 属安全上下文），canvas 截帧 + 椭圆圈选/裁剪编辑，最终 JPEG 写入 composer 的隐藏 `<input type=file>` 触发 change，完全复用 DSH 原生附件管线（限额、缩略图、草稿）。
- **家长监护**（`dsh-ai-tutor-guard/index.js`）：host 插件两层防护——`ctx.systemPrompt.section` 注入家长话题白名单（order 100，紧跟人格）；`agent/pre-step` waterfall 对命中禁区关键词的消息，在给模型的副本末尾追加监护指令（会话日志保留孩子原文）。家长配置 = 插件 Config 的 volatile 字段，投影到 Web 设置页表单，改动写回 profile patch 层。

## 路线图

- P1.1：新对话按钮、品牌名「AI 功课辅导」进 hero/侧栏
- M1：preset 工具收紧（去掉 write/edit）、儿童 profile 存储隔离、浏览器 TTS、监护语义级分类（小模型判定替代关键词）
- P2：平板 / 手机 APP

## 许可

保留所有权利（个人项目）。
