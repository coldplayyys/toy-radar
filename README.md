# 潮玩雷达 · 数据同步与固定链接说明

## 一、数据是怎么“同步”进软件的

整个产品是纯静态前端，数据来自 `toy-radar-data.js`。同步的本质是**每周把新数据重新生成一遍**：

```
潮玩雷达数据/<日期文件夹>/潮玩品类数据7.26-8.1.md   ← 每周放入新 md（文件名带上周区间，可放在日期子文件夹）
        │  python generate_toy_radar_data.py
        ▼
toy-radar-data.js                       ← 自动重新生成，周快照自动累积
        │
        ▼
index.html / toy-radar-app.js           ← 页面直接读取展示
```

生成器会递归扫描 `潮玩雷达数据/` 下所有 `潮玩品类数据*.md`（含日期子文件夹），按周排序追加到 `weeklySnapshots`，
所以**趋势页的折线每周会自动多一个真实数据点**，不需要改任何前端代码。

### 每周要做的三件事

1. 把新一周的表格整理成 md，文件名写成 `潮玩品类数据7.26-8.1.md` 这种格式（周区间写在文件名里），放进 `潮玩雷达数据/` 下任意位置（建议按日期建子文件夹）；
2. 运行 `python generate_toy_radar_data.py`；
3. 部署（见下文固定链接方案）。

想再省一步，可以做成全自动：

- **本机自动**：用 Windows「任务计划程序」每周定时跑一次第 2 步（`python generate_toy_radar_data.py`），前提是第 1 步的 md 已经放进文件夹；
- **云端自动**：仓库里已带 `.github/workflows/deploy.yml`，每周日自动重新生成并发布，第 2、3 步都不用手动做；
- **Codex 自动化**：也可以让 Codex 每周定时提醒你拖入新数据并执行生成。

## 二、把榜单截图变成数据（OCR 流水线，全本地）

每周从公众号（如「IP文创潮」）拿到的通常是一堆榜单截图。`ocr_toy_data.py` 把它们识别成
`generate_toy_radar_data.py` 能直接解析的六列表格，**不需要任何 API Key**（本地 RapidOCR，
依赖：`pip install rapidocr_onnxruntime`）。

```powershell
# 1. 先看识别效果，不写文件；--dump 顺便导出识别原文（校对用，也是下次调参的缓存）
python ocr_toy_data.py "潮玩雷达数据/8.15数据" --dump "潮玩雷达数据/8.15数据/ocr原文"

# 2. 生成周数据 md（文件名必须带周区间，生成器才会按周累积）
python ocr_toy_data.py "潮玩雷达数据/8.15数据" --write --week "8.9-8.15"

# 3. 重新生成前端数据并部署
python generate_toy_radar_data.py
```

会产出三样东西：

- `潮玩品类数据<周区间>.md`：六列表格，品类 / 商品名 / 已售 / 单价 / 店铺 / 统计日期；
- `潮玩品类数据<周区间>-待核对.md`：**需要人工扫一眼的行**（数字没认全、置信度低、或水印粘进数字）；
- `潮玩雷达数据/<周>/ocr原文/`：每张截图的原始识别文本（含坐标），排查问题时用。

识别噪声在 `ocr_corrections.json` 里维护：左边写错字、右边写对的；右边留空字符串就是删掉
（公众号水印常用这招）。发现的错字补一次，后面每周都省事。

对着三周人工整理的旧 md 实测：**商品名几乎全部命中，可用商品行召回约 86%**，
剩下每期 17 行左右进待核对清单。也就是说它替代的是「手打表格」，不是「最后一道校对」。

想随时量一下准确率：

```powershell
python ocr_toy_data.py "潮玩雷达数据/8.15数据" --compare "潮玩雷达数据/8.15数据/潮玩品类数据8.9-8.15.md"
```

## 三、固定链接怎么来

按“稳定程度”分三档，从零成本到正式发布：

### 档位 1：本机固定链接（最快，仅供自己看）

双击 `启动仪表盘.bat`，浏览器会自动打开 **http://localhost:8000/**。
端口固定，所以这个地址在你电脑上是“固定”的，但只有你本机能访问。

### 档位 2：局域网链接（演示当天可用）

同一 Wi-Fi 下先跑 `启动仪表盘.bat`，再用以下命令查本机 IP：

```powershell
ipconfig
```

把 `IPv4 地址`（如 `192.168.1.8`）告诉评委，他们访问 `http://192.168.1.8:8000/` 即可。
若打不开，多半是 Windows 防火墙拦截了 8000 端口，放行 Python 即可。

临时公网链接（现场演示急救）：可以用 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
或 ngrok 给本机 8000 端口生成一个临时公网地址，演示当天够用，但地址不固定。

### 档位 3：正式固定链接（推荐，免费且长期有效）

用 GitHub Pages 发布，链接形如 `https://<你的用户名>.github.io/<仓库名>/`，永久固定、评委随时可打开。

一次性配置步骤：

1. 把这个文件夹变成 git 仓库并推到 GitHub：

   ```powershell
   git init
   git add .
   git commit -m "潮玩雷达 v1"
   git branch -M main
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```

2. 打开仓库 **Settings → Pages**，在 “Build and deployment” 里把 Source 选成 **GitHub Actions**；
3. 工作流 `.github/workflows/deploy.yml` 已经就位：每次 `push` 或每周日定时都会自动重新生成数据并发布；
4. 等第一次跑完，访问 `https://<用户名>.github.io/<仓库名>/` 即可。

之后每周只需要把新 md 提交推送到 main 分支（或让云端定时任务处理），链接不变、数据自动更新。

## 四、常见问题

- **趋势图为什么只有本周一个点？** 因为目前只有一期真实快照。把第二周 md 放进去重新生成后，
  趋势线会真实长出来；页面上“演示模式”只是展示形态的模拟数据，已明确标注。
- **数据来自第三方榜单（蝉妈妈/抖查查等）能全自动吗？** 可以，但需要额外一步：写一个抓取脚本把榜单
  转成 md 放进数据目录（通常需要账号/API 凭证）。当前方案默认你手工粘贴整理成 md，之后的生成、累积、发布都是自动的。
- **换了电脑怎么办？** 用档位 3 把仓库推到 GitHub，任何电脑 clone 下来跑一次生成器即可。
