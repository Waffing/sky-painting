const GUIDE_STEPS = [
  ['选轨迹', '挑一条内置示例、导入自己的飞行日志 CSV，或直接在空域里手绘一笔。'],
  ['看雕塑', '轨迹落成能转着看的 3D 雕塑：粗处慢、细处快，低空偏青、高空偏暖金。'],
  ['选画名领勋章', '按飞行特征自动颁一枚勋章，配一句颁奖词；画名可换批候选或手改。'],
  ['生成海报', '选模板与视角，实时预览 1200×1600 竖版海报，一键下载 PNG。'],
  ['存入画廊', '作品以轻量 JSON 存进浏览器本地；画廊回看、重下载、删除或拼墙。'],
]

export default function AboutView() {
  return (
    <section aria-labelledby="about-title" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="rounded-card border border-rule bg-paper px-5 py-6 text-ink sm:px-8 sm:py-9">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">About</p>
        <h2 id="about-title" className="mt-2 font-display text-2xl sm:text-3xl">
          关于这幅画
        </h2>

        <div className="mt-7 space-y-8">
          <section aria-label="痛点">
            <h3 className="text-sm font-semibold">① 我们看到的痛点</h3>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-muted">
              飞手飞完一次，手里只剩一串没人看的日志数字：高度、速度、坐标，躺在 CSV 里吃灰。
              社团做战报、招新海报时，又要把这些数字手动排版成图，慢且不好看。飞行本身很美，但它的记录没有被当成作品对待。
            </p>
          </section>

          <section aria-label="价值">
            <h3 className="text-sm font-semibold">② 它提供的价值</h3>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-muted">
              10 秒把一次飞行变成三样能带走的东西：一件能转着看的 3D 轨迹雕塑、一张 1200×1600 的艺术海报、一枚按飞行特征颁发的飞行勋章。
              不用设计软件、不用排版，飞完即成品——这正是 LifeHack 赛道想要的「把日常工具变成创造力杠杆」。
            </p>
          </section>

          <section aria-label="使用指南">
            <h3 className="text-sm font-semibold">③ 五步使用指南</h3>
            <ol className="mt-2 space-y-2">
              {GUIDE_STEPS.map(([name, desc], index) => (
                <li key={name} className="flex gap-3 text-sm">
                  <span className="shrink-0 font-mono text-[11px] leading-6 text-ink-muted">{index + 1}</span>
                  <p className="leading-6">
                    <strong className="font-semibold">{name}</strong>
                    <span className="ml-2 text-ink-muted">{desc}</span>
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="用 Qoder 协作开发">
            <h3 className="text-sm font-semibold">④ 用 Qoder 协作开发</h3>
            <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
              本作品由 Qoder 协作完成。左栏为真实开发记录；右栏协作截图位留待补充。
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="rounded-card border border-rule bg-paper-shade px-4 py-6 text-left">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">开发记录</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  本作品全程在 Qoder 中开发，历时两天，六个阶段逐步推进：项目骨架 → 轨迹数据层 → 3D 轨迹雕塑舞台 → 自动命名与飞行勋章 → 高清海报导出 → 画廊与拼墙。每个阶段都先出实施计划、评审通过后再写代码，完工用自动化断言逐项验收（六步累计 700 余条），核心数据层与回归脚本一经冻结全程未改。开发中主要使用 Qwen 系列模型，几何与渲染难题集中在第二阶段攻克。
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  所有飞行数据处理均为纯前端规则实现，零外部 AI 接口；没有真实时间戳的轨迹一律标注『估算时长』，不冒充真实飞行时长。
                </p>
              </div>
              <div className="rounded-card border border-dashed border-rule bg-paper-shade px-4 py-6 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">协作截图 · 占位</p>
                <p className="mt-2 text-xs text-ink-muted">待填：Qoder 会话 / 团队协作文档截图</p>
              </div>
            </div>
          </section>

          <section aria-label="参赛信息">
            <h3 className="text-sm font-semibold">⑤ 参赛信息</h3>
            <p className="mt-1.5 text-sm text-ink-muted">2026 Qoder 高校创造力大赛 · LifeHack 赛道</p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                ['队名', '与你的诀别诗'],
                ['学校', '北部湾大学'],
                ['Qoder 账号', '1560160718162266'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-card border border-rule bg-paper-shade px-4 py-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              数据只存在你这台设备的浏览器本地存储里（轻量 JSON），不上传、不共享；清浏览器数据会一并清掉作品。
            </p>
          </section>
        </div>
      </div>
    </section>
  )
}