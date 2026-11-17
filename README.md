<div align="center">

# 🖼️ 天上掉下一幅画

### *每一次起飞，都值得留下一幅画。*

**把一次无人机飞行的轨迹，变成一座可旋转的 3D 雕塑、一张自动命名的艺术海报、一枚按数据颁发的飞行勋章。**

[![在线演示](https://img.shields.io/badge/在线演示-打开即玩-2ea44f?style=flat-square)](https://sky-painting-m33wci77q34.qoder.zone) [![赛道](https://img.shields.io/badge/2026_Qoder_高校创造力大赛-LifeHack-blue?style=flat-square)](#-参赛信息) [![技术栈](https://img.shields.io/badge/Vite_+_React_+_Three.js-项目技术栈-646cff?style=flat-square)](#-技术栈) [![纯前端](https://img.shields.io/badge/纯前端-零后端_·_零外部_AI_接口-orange?style=flat-square)](#-核心设计)

**▶ 在线演示：[https://sky-painting-m33wci77q34.qoder.zone](https://sky-painting-m33wci77q34.qoder.zone)**（免登录，打开即玩）

</div>

---

## 📌 这是什么

飞手飞完一次，留下的只有飞行记录里一串没人看的数字：航程、高度、转弯数……沉在 App 里再也不会打开；社团做战报、招新海报时，又要对着这些数字慢慢排版。

**《天上掉下一幅画》** 是一个纯前端小工具：导入一次飞行的轨迹数据（内置示例 / 手绘航线 / 飞行记录导出的 CSV），10 秒内产出三样能带走的作品：

| 产出 | 说明 |
|---|---|
| 🗿 **3D 轨迹雕塑** | 可拖动旋转；高度决定颜色（低空青 `#6fe3f4` → 高空暖金 `#f6c560`），速度决定粗细，急转弯处发光 |
| 🖼️ **艺术海报** | 1200×1600 高清 PNG，三套模板（晴空 / 黄昏 / 夜航），自动排版，可署名落款 |
| 🏅 **飞行勋章** | 8 枚勋章按飞行数据规则判定，附专属颁奖词 |

作品可存入浏览器本地画廊（只存轻量数据、不存图片），还可多选 2–9 张拼成一张「作品墙」导出。

## 🚀 快速开始

```bash
npm install
npm run dev      # 本地开发
npm run build    # 构建（base: './'，可部署到任意静态托管）
```

数据层回归验证（83 条断言）：

```bash
node scripts/verify-flight-data.mjs
```

## 🎮 使用流程（5 步）

1. **选轨迹** — 3 条内置示例一键体验；在舞台上手绘一条航线；或导入飞行记录导出的 CSV（支持经纬度 / 平面坐标两种列）
2. **看雕塑** — 轨迹自动成型为 3D 雕塑，拖动旋转、滚轮缩放，点「重飞」看发光点沿轨迹再飞一遍
3. **选画名领勋章** — 按轨迹特征生成 3 个候选画名（可换一批、可手改），勋章按数据自动颁发
4. **生成海报** — 选模板、填署名与落款，下载 1200×1600 PNG（可选用你当前旋转的角度出图）
5. **存入画廊** — 作品保存在浏览器本地，随时重下载，或多张拼成作品墙

## 🔬 核心设计

### 数据层（`src/utils/flightData.js`，已冻结）

- 统一轨迹点结构 `{ x, y, alt, speed, t, isTurn }`（ENU 米制坐标，与渲染器无关）
- 流水线顺序写死：**原始点列 → 统计 → 转弯判定 → 抽稀（硬顶 240 点）→ 居中**；统计只认原始数据，抽稀不影响任何指标
- **转弯判定**：带符号累计航向算法（左正右负，直线抖动自动抵消），累计 ≥ 35° 记一次转弯；相邻段 < 1 米不参与累计，悬停/GPS 抖动不刷假转弯
- **11 项冻结指标**：总距离、最高高度、平均/最高速度、速度标准差、转弯次数、闭合度、高度起伏、累计爬升、时长、`isEstimatedDuration`
- **诚实口径**：没有真实时间戳的轨迹，时长按距离/均速估算并全站标注「估算时长」，不冒充真实飞行时长
- CSV 解析器：宽松表头匹配、经纬度局部等距投影、缺速度列自动推算、四种时间格式容错、脏数据静默降级不崩溃

### 3D 舞台（`src/stage/`）

- WebGL 标准线宽被锁死为 1px，「速度决定粗细」用**自定义变半径 Tube 几何**实现（平行移动标架，防扭转麻花）
- 三级降级梯子：变径管线 → LineSegments2 宽线 → 恒径管线（速度改由明暗表达），任一级都保住高度渐变与转弯标记
- 手绘模式：锁定俯视画板（固定 300m×300m 空域），笔迹走与导入数据**同一套**处理流水线
- `captureStagePng()`：同帧渲染取图导出透明底高清雕塑图（供海报合成），不依赖隔帧截图

### 命名与勋章（纯规则，零 AI 接口）

- **命名**（`src/utils/naming.js`）：轨迹特征 hash 做种子 + 三段式词库（82 词，句式池混排）确定性生成 — 同一条轨迹刷新不乱跳；换一批不与上一批重复；词库已避开知名歌名/书名
- **勋章**（`src/utils/badges.js`）：8 枚按优先级链判定（盘旋大师 → 完美闭环 → 过山车手 → 登云者 → 远行者 → 低空掠影 → 稳如磐石 → 佛系巡航），阈值按真实飞行可达性校准（如登云者 120 m 对齐常规飞行限高）
- 勋章图为纯函数 SVG（`getBadgeSvgString`），页面与海报 Canvas 共用同一份代码、同一视觉

### 画廊（零 WebGL）

- 缩略图与重下载走纯 2D 等距投影器（`src/utils/projector.js`，45°/35° 与舞台同视角 + 画家算法深度排序），不逐卡建 Three.js 实例 — 手机 WebGL 上下文有硬上限，这条路绕开了它
- 存储只存元数据 + 抽稀点列（单件 ≈ 17 KB），严禁 Base64 图片入库

## 🧱 技术栈

| 层 | 选型 |
|---|---|
| 构建 / 框架 | Vite 8 · React 19（全 JavaScript，无 TypeScript） |
| 3D | Three.js 0.187（OrbitControls / Line2 仅作降级梯子） |
| 样式 | Tailwind CSS v4 · 设计令牌单一来源 `src/styles/tokens.css` · 系统字体栈（无外部字体 CDN） |
| 存储 | localStorage 轻量 JSON（schema v1，容量护栏 64 KB/件） |
| 部署 | Qoder Sites（静态托管，`base: './'`） |

## 📁 项目结构

```
├─ scripts/verify-flight-data.mjs   数据层永久回归（83 条断言）
└─ src/
   ├─ utils/    flightData（数据层）/ naming / badges / badgeSvg / poster / projector / wall / storage
   ├─ stage/    flightScene / tubeGeometry / lineTrace / handDraw / palette / speedScale / StageCanvas
   ├─ components/ SourceBar / StatsStrip / StageControls / NameplateCard / PosterPanel / WorkCard / WorkDialog
   ├─ views/    StudioView（创作台）/ GalleryView（画廊）/ AboutView（关于）
   └─ styles/   tokens.css（全站色值唯一来源）/ global.css
```

## 🛠️ 开发过程

全程在 **Qoder** 中开发，历时两天，六个阶段「先计划、评审通过后再写代码，完工逐项断言验收」：

| 阶段 | 内容 | 验收规模 |
|---|---|---|
| Step 0 | 项目骨架与设计令牌 | 构建 + 多宽度渲染检查 |
| Step 1 | 轨迹数据层 | 83 条断言 |
| Step 2 | 3D 轨迹雕塑舞台 | 92 项浏览器实测 |
| Step 3 | 自动命名 + 飞行勋章 | 475 条（浏览器 235 + Node 240） |
| Step 4 | 高清海报导出 + 存入画廊 | 212 条（浏览器 95 + Node 117） |
| Step 5 | 画廊 / 拼墙 / 关于 / 上线检查 | 81 条（浏览器 48 + Node 33） |

核心数据层与回归脚本一经冻结，**全程 sha256 未变**。开发中主要使用 Qwen 系列模型。

## 🏆 参赛信息

- **赛事**：2026 Qoder 高校创造力大赛（天池 532536）· **LifeHack** 赛道
- **队伍**：与你的诀别诗队 · **北部湾大学**（无人机应用技术协会）
- **Qoder 账号**：1560160718162266
- **在线演示**：https://sky-painting-m33wci77q34.qoder.zone

---

<div align="center">

*每一次起飞，都值得留下一幅画。*

</div>
