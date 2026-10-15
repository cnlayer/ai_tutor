# 部署 v1.0 到 Ubuntu 服务器（R720）

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

## 2. 创建 ai-tutor profile 并挂载两个本地 bundle

```bash
dsh ai-tutor --from-default-profile web --dump-config   # 只创建 profile 并打印组合树，不启动
dsh plugin --profile ai-tutor add ./dsh-ai-tutor
dsh plugin --profile ai-tutor add ./dsh-ai-tutor-kid
```

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

## 7. 升级

```bash
cd ai_tutor && git pull
dsh plugin --profile ai-tutor add ./dsh-ai-tutor ./dsh-ai-tutor-kid   # link: 依赖，重新解析
sudo systemctl restart ai-tutor
```

## 验证清单

1. 打开 token URL → 直接进入「AI 功课辅导」对话界面（无侧边栏/轨迹/工作区选择）
2. 发一句话建立对话 → 输入框左下出现 📷 按钮
3. 拍照 → 圈选/裁剪 → 加入对话 → 发送 → 模型读图讲解（需视觉模型：bailian qwen3.8 系列）
4. 思考链文本不显示，工具活动行（"已完成，用时 N 秒"）保留
