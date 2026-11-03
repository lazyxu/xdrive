(async () => {
  const root = "/lazyxu/xdrive";
  const cancelPR = true;       // false：只清理旧 master CI
  const intervalMs = 600;      // 每次请求之间间隔 600ms
  const maxRequests = 250;

  // 从 GitHub 同源 CI 列表自动获取旧 master Check Suite ID。
  const masterSuites = await (async () => {
    if (location.origin !== "https://github.com" ||
        !location.pathname.startsWith(root + "/")) {
      throw new Error("请在 xDrive 的 GitHub 页面执行");
    }

    const read = async url => {
      const response = await fetch(url, {
        credentials: "same-origin", cache: "no-store"
      });
      if (!response.ok) throw new Error("读取 GitHub 失败: HTTP " + response.status);
      return response.text();
    };
    const feed = await read(root + "/commits/master.atom");
    const first = feed.match(/<entry\b[\s\S]*?<\/entry>/i)?.[0] || "";
    const head = first.match(/Grit::Commit\/([0-9a-f]{40})/i)?.[1] ||
      first.match(/\/commit\/([0-9a-f]{40})/i)?.[1];
    if (!head) throw new Error("无法确认当前 master SHA");

    // 页面数据位于 workflowRunsRoute.workflowRuns，而不是 REST API 的字段结构。
    const findRuns = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 10) return null;
      if (Array.isArray(value.workflowRunsRoute?.workflowRuns)) {
        return value.workflowRunsRoute.workflowRuns;
      }
      for (const child of Object.values(value)) {
        const runs = findRuns(child, depth + 1);
        if (runs) return runs;
      }
      return null;
    };

    const all = new Map();
    const seenPages = new Set();
    let consecutiveTerminalPages = 0;
    for (let page = 1; ; page++) {
      const html = await read(root + "/actions/workflows/ci.yml?" +
        new URLSearchParams({ query: "branch:master", page }));
      const documentCopy = new DOMParser().parseFromString(html, "text/html");
      let rows = null;
      for (const script of documentCopy.querySelectorAll('script[type="application/json"]')) {
        try { rows = findRuns(JSON.parse(script.textContent)); } catch { /* irrelevant JSON */ }
        if (rows) break;
      }
      if (!Array.isArray(rows)) {
        throw new Error("第 " + page + " 页缺少 workflowRunsRoute.workflowRuns");
      }
      if (!rows.length) break;
      const pageIds = rows.map(run => String(run?.id)).join(",");
      if (seenPages.has(pageIds)) {
        throw new Error("GitHub 分页返回重复内容，停止操作，避免漏查");
      }
      seenPages.add(pageIds);
      console.log("第 " + page + " 页发现 " + rows.length + " 个 CI Run");
      for (const run of rows) {
        if (run?.branch?.name !== "refs/heads/master" ||
            run.workflowFilePath !== ".github/workflows/ci.yml") continue;
        const id = Number(run.id);
        const sha = run.description?.linkUrl?.match(
          /^\/lazyxu\/xdrive\/commit\/([0-9a-f]{40})$/)?.[1];
        const suite = run.actions?.cancelUrl?.match(
          /^\/lazyxu\/xdrive\/suites\/(\d+)\/cancel$/)?.[1];
        if (!Number.isSafeInteger(id) || id <= 0 ||
            !sha || !Number.isFinite(Date.parse(run.createdAt?.timestamp))) {
          throw new Error("master Run 缺少 Commit/时间: " + run.id);
        }
        all.set(id, {
          id, sha, suite,
          created: run.createdAt.timestamp,
          queued: run.state?.status === "WORKFLOW_RUN_STATUS_QUEUED"
        });
      }
      // 创建时间排序不代表状态连续：单页终态不足以说明更旧 Run 已结束。
      // 按约定，连续两页终态才停止；否则继续翻页。
      const statusCounts = {};
      for (const run of rows) {
        const state = String(run?.state?.status || "UNKNOWN")
          .replace(/^WORKFLOW_RUN_STATUS_/, "");
        statusCounts[state] = (statusCounts[state] || 0) + 1;
      }
      const uiActive = rows.filter(run =>
        /queued|pending|waiting|in.?progress|running/i.test(
          String(run?.timing?.text || "")));
      const mismatch = uiActive.filter(run =>
        /^(?:WORKFLOW_RUN_STATUS_)?(?:COMPLETED|CANCELLED|CANCELED)$/.test(
          String(run?.state?.status || "")));
      console.log("第 " + page + " 页状态:", statusCounts,
        "界面显示待处理:", uiActive.length);
      if (mismatch.length) {
        console.warn("页面状态字段与显示文案不一致（不取消）：",
          mismatch.map(run => run.id));
      }
      // 只有连续两个完整页面全部终态，才允许提前结束扫描。
      // 界面显示排队/运行中的页面不能计入连续终态页。
      const terminalStatuses = new Set([
        "WORKFLOW_RUN_STATUS_COMPLETED",
        "WORKFLOW_RUN_STATUS_CANCELLED",
        "WORKFLOW_RUN_STATUS_CANCELED"
      ]);
      const terminalPage = rows.length === 25 &&
        rows.every(run => terminalStatuses.has(run?.state?.status)) &&
        mismatch.length === 0;
      consecutiveTerminalPages = terminalPage ? consecutiveTerminalPages + 1 : 0;
      console.log("连续终态页:", consecutiveTerminalPages + "/2");
      if (consecutiveTerminalPages >= 2) {
        console.log("连续两页全部终态，停止翻页");
        break;
      }
      if (rows.length < 25) {
        console.log("第 " + page + " 页为最后一页，停止翻页");
        break;
      }
    }

    if (!all.size) throw new Error("没有找到 master CI Run，安全停止");
    const old = [...all.values()].filter(run => run.sha !== head)
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    // 只保护当前 master 和最近 1 个旧 master Run，且只识别排队中的 Suite。
    const selected = old.slice(1).filter(run => run.queued);
    if (selected.some(run => !/^\d+$/.test(run.suite || ""))) {
      throw new Error("候选 master Run 缺少 Check Suite 取消链接，安全停止");
    }
    console.log("当前 master:", head, "master CI:", all.size,
      "旧 master:", old.length, "待取消 Suite:", selected.length);
    return selected.map(run => run.suite).join(" ");
  })();

  // 已关闭 PR #410 的遗留 CI Check Suite
  const prSuites = `
100245578594
  `;

  if (location.origin !== "https://github.com" ||
      !location.pathname.startsWith(root + "/")) {
    console.error("请在 xDrive 的 GitHub 页面执行");
    return;
  }

  const parseIds = text =>
    text.trim().split(/\s+/).filter(Boolean).map(Number);

  const candidates = [...new Set([
    ...parseIds(masterSuites),
    ...(cancelPR ? parseIds(prSuites) : [])
  ])];

  // 保护此前指定的 Suite 和当前 master
  const protectedSuites = new Set([
    110759196899,
    112671380755
  ]);

  const tasks = candidates.filter(
    id => Number.isSafeInteger(id) && !protectedSuites.has(id)
  ).slice(0, maxRequests);

  console.log("旧 master CI:", parseIds(masterSuites).length);
  console.log("PR CI:", cancelPR ? parseIds(prSuites).length : 0);
  console.log("计划发送取消请求:", tasks.length);
  console.log("保护当前 master CI: 112671380755");

  console.table(tasks.map(id => ({ suiteId: id })));

  if (!confirm(`确认向 ${tasks.length} 个旧 CI 发送取消请求？`)) {
    return;
  }

  window.xdriveStopCancel = false;

  let accepted = 0;
  let failed = 0;
  let stopped = false;

  for (const [index, suiteId] of tasks.entries()) {
    if (window.xdriveStopCancel) {
      stopped = true;
      break;
    }

    try {
      const response = await fetch(
        `${root}/suites/${suiteId}/cancel`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "github-is-react": "true",
            "github-verified-fetch": "true",
            "x-requested-with": "XMLHttpRequest"
          },
          body: null
        }
      );

      const result = await response.text();

      if (
        response.status === 200 &&
        result.includes("successfully requested")
      ) {
        accepted++;
      } else {
        failed++;
        console.warn(
          `Suite ${suiteId}: HTTP ${response.status}`,
          result.slice(0, 180)
        );

        if ([401, 403, 429].includes(response.status)) {
          console.error("遇到授权或限流问题，停止批量操作");
          stopped = true;
          break;
        }
      }
    } catch (error) {
      failed++;
      console.error(`Suite ${suiteId}:`, error);
      stopped = true;
      break;
    }

    if ((index + 1) % 10 === 0) {
      console.log(
        `进度 ${index + 1}/${tasks.length} | ` +
        `GitHub 已接受 ${accepted} | 失败 ${failed}`
      );
    }

    await new Promise(
      resolve => setTimeout(resolve, intervalMs)
    );
  }

  console.log("===== 取消请求结束 =====");
  console.table({
    total: tasks.length,
    accepted,
    failed,
    stopped
  });

  console.log(
    "注意：accepted 表示 GitHub 接受取消请求，" +
    "不代表工作流已完全转为 Cancelled。"
  );
})();
