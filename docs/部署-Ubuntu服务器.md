# 部署 v1.2 到 Ubuntu 服务器（R720）

## 0. 前提

- Ubuntu 20.04+，Node.js **≥ 22.5**（DSH 使用 `node:sqlite`；推荐 Node 24 LTS）：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # 应显示 v24.x
```

- 服务器能访问模型后端：zion 在 `http://192.168.5.8:1234`（需与 R720 同网段），bailian 走公网。
- 国内网络安装 npm 包慢的话先换镜像：`npm config set registry https://registry.npmmirror.com`（装完 DSH 后可换回）。

## 1. 安装 DSH 与项目

```bash
sudo npm i -g @deepseek-ai/dsh pnpm
git clone https://github.com/cnlayer/ai_tutor.git
cd ai_tutor
```

## 2. 创建 ai-tutor profile 并挂载三个本地 bundle

```bash
dsh ai-tutor --from-default-profile web --dump-config   # 只创建 profile 并打印组合树，不启动
# guard bundle 有自己的 npm 依赖；link: 依赖不会自动装，先手动装一次
cd dsh-ai-tutor-guard && npm install --registry=https://registry.npmmirror.com && cd ..
dsh plugin --profile ai-tutor add ./dsh-ai-tutor ./dsh-ai-tutor-kid ./dsh-ai-tutor-guard
```

- `./xxx` 这类相对路径按**执行命令时所在的目录**解析（dsh 会先转成绝对路径再交给 pnpm），所以必须在仓库根目录执行。装完后 profile 里记的是 `link:/home/<你>/ai_tutor/dsh-ai-tutor-guard` 这样的绝对链接，以后 `git pull` 直接生效，不必重装。
- 三个 bundle 都要装：`dsh-ai-tutor`（preset）、`dsh-ai-tutor-kid`（孩子端界面裁剪）、`dsh-ai-tutor-guard`（监护规则 + v1.2 的「新对话 / 清空历史」按钮）。

## 3. 配置模型 provider

把 Windows 开发机上已调好的这份文件原样拷到服务器（含 bailian key 与 zion 地址）：

```
Windows: C:\Users\BLW\.dsh\profiles\ai-tutor\cordis.patch.yml
服务器:  ~/.dsh/profiles/ai-tutor/cordis.patch.yml
```

例：`scp` 过去，或 `git` 之外的任意方式。若服务器网段不同，改 zion 的 `baseUrl`。

## 4. 启动（局域网访问）

```bash
dsh ai-tutor --host 0.0.0.0 --port 3090 --no-open --trusted-host 192.168.5.X:3090
```

- 终端会打印带 token 的 URL（每次启动都会换 token）。
- `--trusted-host` 填浏览器地址栏里用的那个 authority（IP 或 IP:port），否则 API 会被浏览器信任围栏拒绝。

## 5. 相机可用的两种方案（重要）

拍照功能用 `getUserMedia`，浏览器只在**安全上下文**（https 或 127.0.0.1）放行。`http://192.168.5.X:3090` 直连时相机按钮会报权限错误。

### 方案 A：Caddy 自签 HTTPS 反代（推荐，全家设备都能用）

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile` 追加：

```
https://192.168.5.X:8443 {
    tls internal
    reverse_proxy 127.0.0.1:3090
}
```

```bash
sudo systemctl reload caddy
```

DSH 启动改为：`dsh ai-tutor --host 127.0.0.1 --port 3090 --no-open --trusted-host 192.168.5.X:8443`

孩子设备访问 `https://192.168.5.X:8443/?token=...`：首次证书警告点「继续访问」即可——HTTPS 协议本身就是安全上下文，相机可用。

### 方案 B：SSH 隧道（单台电脑，零证书）

在访问端（Windows/Linux 皆可）：

```bash
ssh -L 3090:127.0.0.1:3090 user@192.168.5.X
```

然后本机打开 `http://127.0.0.1:3090/?token=...`——loopback 是安全上下文，相机可用。服务器端 DSH 保持 `--host 127.0.0.1`，无需 `--trusted-host`。

## 6. systemd 常驻（可选）

`/etc/systemd/system/ai-tutor.service`：

```ini
[Unit]
Description=AI Tutor (DSH profile)
After=network-online.target

[Service]
User=<你的用户名>
WorkingDirectory=/home/<你的用户名>/ai_tutor
ExecStart=/usr/bin/dsh ai-tutor --host 127.0.0.1 --port 3090 --no-open --trusted-host 192.168.5.X:8443
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-tutor
journalctl -u ai-tutor | grep 'dsh web'   # 取最新 token URL
```

`User=` 必须是**执行过 `dsh plugin add` 的那个用户**：profile 和插件链接都在该用户的 `~/.dsh` 下，换成别的用户服务就读不到（表现是界面回到原生 DSH 样子、没有孩子端裁剪）。

## 7. 升级（以 v1.1 → v1.2 为例）

```bash
cd ai_tutor && git pull
# link: 依赖不会自动装 npm 依赖，装一次（依赖没变时可跳过）
cd dsh-ai-tutor-guard && npm install --registry=https://registry.npmmirror.com && cd ..
dsh plugin --profile ai-tutor add ./dsh-ai-tutor ./dsh-ai-tutor-kid ./dsh-ai-tutor-guard
sudo systemctl restart ai-tutor
```

然后**浏览器硬刷新**（Ctrl+Shift+R，或换个无痕窗口）。

为什么这三步都不能省：

- `git pull` 只改磁盘上的文件。浏览器要加载的 client 脚本清单（`window.__DSH_BOOT__.entries`）是**服务启动时**扫描已挂载的 bundle 生成的，并写进 HTML；不重启服务，新 bundle 就不会出现在清单里。
- 页面本身也要刷新：已经打开的标签页拿的是上一次启动时生成的清单。
- 只有 **host 半边**是热重载的：改 `cordis.patch.yml` 里的监护配置保存即生效，不用重启。

## 8. 家长监护（v1.1，v1.2 增加了「清空历史」）

孩子端的聊天内容白名单（默认仅作业辅导）由家长定义。配置入口与规则见 [docs/家长监护.md](./家长监护.md)，其中「清理会话历史（v1.2）」一节说明两个按钮的行为与物理删除范围。

服务器上家长改配置的方式：SSH 登录后编辑 `~/.dsh/profiles/ai-tutor/cordis.patch.yml`（见文档）；保存即热生效（patchReload: live）。

## 9. 排查：升级后看不到「新对话 / 清空历史」按钮

按钮由 guard bundle 的 **client 半边**（`dsh-ai-tutor-guard/client.js`）注册到会话头部槽位 `conversation.session.header.actions`。从磁盘到屏幕一共四道关口，按顺序查，每一步都有明确的绿/红信号。

### ⓪ 先确认看的地方对

按钮在**会话页顶部标题行的右侧**（和会话标题同一行），不在输入框旁边。而且 DSH 在**空白新会话（Hero 态）会隐藏整条标题栏**——所以必须先进入一个**已经说过话的会话**，按钮才会出现。这一条排除了大半「装错了」的误判。

### ① 服务器有没有把 client bundle 下发给浏览器（先跑这条）

```bash
URL=$(journalctl -u ai-tutor -n 500 --no-pager | grep -oE 'http://[^ ]*\?token=[^ ]+' | tail -1)
curl -s "$URL" | grep -c 'dsh-ai-tutor-guard'
```

（前台启动的话，直接复制终端里 `dsh web: http://...?token=...` 那行；token 每次启动都会换。）

- 输出 **≥ 1**（开发机实测 5）→ 服务器侧正常，问题在浏览器，跳到 ④。
- 输出 **0** → bundle 没挂上，继续 ②。

### ② profile 里到底装没装、链接指向哪

```bash
grep -A6 dependencies ~/.dsh/profiles/ai-tutor/package.json
ls -l ~/.dsh/profiles/ai-tutor/node_modules/@local/
```

期望：依赖里有 `"@local/dsh-ai-tutor-guard": "link:/home/<你>/ai_tutor/dsh-ai-tutor-guard"`，且 `node_modules/@local/dsh-ai-tutor-guard` 是指向你 `git pull` 的那个仓库目录的符号链接。

常见错法：不在仓库根目录执行 `dsh plugin add ./dsh-ai-tutor-guard`（相对路径按执行目录解析），结果 link 指向空目录或安装直接失败。补救用绝对路径：

```bash
dsh plugin --profile ai-tutor add /home/<你>/ai_tutor/dsh-ai-tutor-guard
```

### ③ host 半边能不能启动

host 行启动失败 → 整行不挂载 → client 半边也不会进清单（表现就是「按钮没有」）：

```bash
ls ~/ai_tutor/dsh-ai-tutor-guard/node_modules/@deepseek-ai/schemastery   # 缺了就 cd 进去 npm install
journalctl -u ai-tutor --since '-15 min' | grep -iE 'guard|schemastery|ERR_MODULE_NOT_FOUND|client-modules'
```

### ④ 浏览器侧

- 硬刷新 Ctrl+Shift+R，或换个无痕窗口——老标签页里的模块清单是上一次启动生成的。
- F12 → Console：`window.__DSH_BOOT__.entries.some(e => e.id === '@local/dsh-ai-tutor-guard')` 应为 `true`。
- F12 → Network：应有一条 `plugins/??@local/dsh-ai-tutor-guard/client.js&rev=…`，状态 200（404 说明 rev 对不上，重启服务再刷新）。
- Console 里若出现 `slot entry crashed in 'conversation.session.header.actions'`，说明 client 半边跑起来了但抛错——把完整报错贴回来。

### ⑤ DSH 版本

```bash
dsh --version    # 需 ≥ 0.2.0-rc.2
```

本仓库在 0.2.0-rc.2 上开发验证，`conversation.session.header.actions` 槽位在该版本可用。旧版先 `sudo npm i -g @deepseek-ai/dsh@latest`，再重跑 §7 的 `dsh plugin add` 并重启。

### ⑥ 还不行

把这三样贴回来：① 的输出、`dsh --version`、`journalctl -u ai-tutor -n 100 --no-pager | tail -50`。

## 验证清单

1. 打开 token URL → 直接进入「AI 功课辅导」对话界面（无侧边栏/轨迹/工作区选择）
2. 发一句话建立对话 → 输入框左下出现 📷 按钮
3. 拍照 → 圈选/裁剪 → 加入对话 → 发送 → 模型读图讲解（需视觉模型：bailian qwen3.8 系列）
4. 思考链文本不显示，工具活动行（"已完成，用时 N 秒"）保留
5. 监护：发「陪我玩游戏」→ 模型温和拒绝并引导回作业；编辑 patch 加一条 `allowedTopics` 保存后发对应话题 → 正常执行（热生效）
6. **v1.2 会话清理**：在已有内容的会话页顶部 → 看到「新对话 / 清空历史」→ 点「新对话」直接开新会话；点「清空历史」→「确认清空」→ 旧会话消失并开新会话，`find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d` 里旧会话目录已减少（当前会话的目录最迟在下次重启时删除）。不显示见 §9
