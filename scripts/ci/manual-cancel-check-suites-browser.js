(async () => {
  const root = "/lazyxu/xdrive";
  const cancelPR = true;       // false：只清理旧 master CI
  const intervalMs = 600;      // 每次请求之间间隔 600ms
  const maxRequests = 250;

  // 只把固定 masterSuites 改为同源自动发现；其余第一版逻辑不变。
  const masterSuites = await (async () => {
    if (location.origin !== "https://github.com" ||
        !location.pathname.startsWith(root + "/")) {
      throw new Error("请在 xDrive 的 GitHub 页面执行");
    }

    const getPage = async url => {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "text/html, application/json, application/atom+xml" }
      });
      if (!response.ok) throw new Error("发现 master CI 失败: HTTP " + response.status + " " + url);
      return response.text();
    };
    const feed = await getPage(root + "/commits/master.atom");
    const first = feed.match(/<entry\b[\s\S]*?<\/entry>/i)?.[0] || "";
    const head = first.match(/Grit::Commit\/([0-9a-f]{40})/i)?.[1] ||
      first.match(/\/commit\/([0-9a-f]{40})/i)?.[1];
    if (!head) throw new Error("无法确认当前 master SHA，停止操作");

    const runs = new Map();
    const linkIds = new Set();
    const num = x => {
      const n = Number(x);
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    };
    const pick = (o, ...keys) => keys.map(k => o?.[k])
      .find(v => v !== undefined && v !== null);
    const walk = (rootNode, callback) => {
      const seen = new Set();
      const visit = (node, depth = 0) => {
        if (!node || typeof node !== "object" || seen.has(node) || depth > 16) return;
        seen.add(node);
        callback(node);
        for (const nested of Object.values(node)) visit(nested, depth + 1);
      };
      visit(rootNode);
    };
    const parse = raw => {
      const roots = [];
      try { roots.push(JSON.parse(raw)); } catch { /* HTML response */ }
      const doc = new DOMParser().parseFromString(raw, "text/html");
      for (const script of doc.querySelectorAll('script[type="application/json"]')) {
        try { roots.push(JSON.parse(script.textContent)); } catch { /* ignore */ }
      }
      for (const link of doc.querySelectorAll('a[href*="/actions/runs/"]')) {
        const m = link.getAttribute("href")?.match(
          /(?:^|\/)lazyxu\/xdrive\/actions\/runs\/(\d+)(?:[/?#]|$)/);
        if (m) linkIds.add(num(m[1]));
      }
      // 同源 React 数据可能包含转义的 run 链接。
      const normalized = raw.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
      for (const m of normalized.matchAll(/\/lazyxu\/xdrive\/actions\/runs\/(\d+)(?:[/?#"' <]|$)/g)) {
        linkIds.add(num(m[1]));
      }
      for (const rootNode of roots) {
        walk(rootNode, object => {
          const id = num(pick(object, "id", "run_id", "runId", "workflowRunId"));
          const sha = pick(object, "head_sha", "headSha");
          const branch = pick(object, "head_branch", "headBranch");
          const event = pick(object, "event", "eventType");
          const path = pick(object, "path", "workflowPath", "workflow_path");
          const created = pick(object, "created_at", "createdAt");
          if (!id || !/^[0-9a-f]{40}$/.test(sha || "") ||
              branch !== "master" || event !== "push" ||
              path !== ".github/workflows/ci.yml" ||
              !Number.isFinite(Date.parse(created))) return;

          const suite = pick(object, "check_suite_id", "checkSuiteId");
          const nested = pick(object, "check_suite", "checkSuite");
          const suiteId = num(suite ?? (typeof nested === "object" ?
            pick(nested, "id", "databaseId") : nested));
          const previous = runs.get(id);
          if (!previous || (!previous.suiteId && suiteId)) {
            runs.set(id, {
              id, suiteId, sha, created,
              status: pick(object, "status"),
              attempt: Number(pick(object, "run_attempt", "runAttempt"))
            });
          }
        });
      }
    };

    // 只查询原版实际涉及的 CI Workflow，不读取当前页面的 PR Runs。
    for (let page = 1; page <= 3; page++) {
      const html = await getPage(root + "/actions/workflows/ci.yml?" +
        new URLSearchParams({ query: "branch:master", page }));
      parse(html);
    }

    const oldRuns = [...runs.values()].filter(r => r.sha !== head)
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
    // 保护当前 master（上方排除）以及最近 1 个旧 master Run。
    const eligible = oldRuns.slice(1).filter(r =>
      r.status === "queued" && r.attempt === 1);
    const missing = eligible.filter(r => !r.suiteId);
    console.log("master:", head, "解析到的 master CI:", runs.size,
      "页面 Run 链接:", linkIds.size, "候选旧 master CI:", eligible.length);

    if (!runs.size) {
      throw new Error("页面未提供可验证的 master CI 元数据；未取消任何任务");
    }
    if (missing.length) {
      throw new Error("发现 " + missing.length + " 个旧 master Run 缺少 Check Suite ID，停止操作");
    }
    return eligible.map(r => r.suiteId).join(" ");
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
