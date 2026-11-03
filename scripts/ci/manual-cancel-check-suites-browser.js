(async () => {
  const root = "/lazyxu/xdrive";
  const intervalMs = 600;
  const maxRequests = 250;
  const pages = 3;              // 最多扫描最近 3 页 CI
  const preserveOld = 1;        // 保护最近 1 个旧 master CI
  const shaPattern = /^[0-9a-f]{40}$/;

  if (location.origin !== "https://github.com" ||
      !location.pathname.startsWith(root + "/")) {
    console.error("请在 xDrive 的 GitHub 页面执行");
    return;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const number = value => Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value) : null;
  const value = (object, ...keys) => keys.map(key => object?.[key])
    .find(item => item !== undefined && item !== null);
  const request = async path => {
    const response = await fetch(path, {
      credentials: "same-origin", cache: "no-store",
      headers: { accept: "text/html, application/atom+xml" }
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  };
  const embedded = html => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const roots = [];
    for (const element of doc.querySelectorAll('script[type="application/json"]')) {
      try { roots.push(JSON.parse(element.textContent)); } catch { /* skip */ }
    }
    return { doc, roots };
  };
  const findObjects = (roots, predicate) => {
    const matched = [], visited = new Set();
    const visit = (node, depth = 0) => {
      if (!node || typeof node !== "object" || visited.has(node) || depth > 16) return;
      visited.add(node);
      if (predicate(node)) matched.push(node);
      for (const child of Object.values(node)) visit(child, depth + 1);
    };
    roots.forEach(root => visit(root));
    return matched;
  };
  // GitHub Actions 列表可能在 DOM、内嵌 React JSON 或 HTML 字符串中。
  const collectRunIds = (doc, roots, html = "") => {
    const ids = new Set();
    const add = id => {
      const n = number(id);
      if (n) ids.add(n);
    };
    for (const a of doc.querySelectorAll('a[href]')) {
      try {
        const url = new URL(a.getAttribute("href"), location.origin);
        const match = url.pathname.match(
          /^\/lazyxu\/xdrive\/actions\/runs\/(\d+)(?:\/|$)/);
        if (url.origin === location.origin && match) add(match[1]);
      } catch { /* invalid href */ }
    }
    // 某些版本的 Actions 页面用 script JSON 渲染列表而不是 <a>。
    for (const item of findObjects(roots, object =>
      number(value(object, "id", "run_id", "runId", "workflowRunId")) &&
      value(object, "head_branch", "headBranch") === "master" &&
      value(object, "event", "eventType") === "push")) {
      add(value(item, "id", "run_id", "runId", "workflowRunId"));
    }
    // JSON 字符串或链接属性可能用 \\/ 或 Unicode 方式转义斜杠。
    const normalized = html.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/");
    const pattern = /(?:https:\/\/github\.com)?\/lazyxu\/xdrive\/actions\/runs\/(\d+)(?:[\/?#"' <]|$)/g;
    for (const match of normalized.matchAll(pattern)) add(match[1]);
    return ids;
  };
  const normalizeRun = object => ({
    id: number(value(object, "id", "run_id", "runId", "workflowRunId")),
    suiteId: number(value(object, "check_suite_id", "checkSuiteId")),
    sha: value(object, "head_sha", "headSha"),
    branch: value(object, "head_branch", "headBranch"),
    event: value(object, "event", "eventType"),
    status: value(object, "status"),
    attempt: Number(value(object, "run_attempt", "runAttempt")),
    path: value(object, "path", "workflowPath", "workflow_path"),
    created: value(object, "created_at", "createdAt")
  });
  const getRunDetails = async id => {
    const { roots } = embedded(await request(`${root}/actions/runs/${id}`));
    const run = findObjects(roots, object => normalizeRun(object).id === id)
      .map(normalizeRun)
      .find(row => row.suiteId && shaPattern.test(row.sha || "") &&
        row.branch && row.event && row.status && row.path &&
        Number.isFinite(Date.parse(row.created))) || null;
    const containers = findObjects(roots, object =>
      ["jobs", "workflowJobs", "jobList"].some(key => object?.[key]));
    for (const container of containers) {
      const raw = value(container, "jobs", "workflowJobs", "jobList");
      const jobs = Array.isArray(raw) ? raw : value(raw, "nodes", "items");
      const count = Number(value(raw, "total_count", "totalCount") ??
        value(container, "jobs_count", "jobsCount", "total_count", "totalCount"));
      if (Array.isArray(jobs) && Number.isSafeInteger(count) &&
          count > 0 && count <= 100 && jobs.length === count &&
          jobs.every(job => job && typeof job === "object" &&
            number(value(job, "id", "jobId")) && value(job, "status") &&
            value(job, "name"))) return { run, jobs };
    }
    return { run, jobs: null }; // 网页不暴露完整 Job 清单时，拒绝取消
  };
  const unstarted = job => {
    const status = value(job, "status");
    const conclusion = value(job, "conclusion");
    const name = value(job, "name");
    if (status === "completed") return conclusion === "skipped" ||
      (name === "pr-scope" && conclusion === "success");
    if (status !== "queued" || conclusion != null) return false;
    const runnerId = value(job, "runner_id", "runnerId");
    const runnerName = value(job, "runner_name", "runnerName");
    // 缺少 runner 字段无法证明 Job 尚未分配机器。
    if (!("runner_id" in job || "runnerId" in job) ||
        !("runner_name" in job || "runnerName" in job) ||
        (runnerId != null && runnerId !== 0) || runnerName) return false;
    const started = value(job, "started_at", "startedAt");
    const created = value(job, "created_at", "createdAt");
    if (started && (!created || started !== created)) return false;
    const steps = value(job, "steps");
    return !steps || (Array.isArray(steps) &&
      !steps.some(step => ["in_progress", "completed"].includes(step?.status)));
  };

  try {
    // GitHub Atom Feed 取当前 master SHA，避免写死保护 ID。
    const feed = await request(`${root}/commits/master.atom`);
    const first = feed.match(/<entry\b[\s\S]*?<\/entry>/i)?.[0] || "";
    const master = first.match(/Grit::Commit\/([a-f0-9]{40})/i)?.[1] ||
      first.match(/\/commit\/([a-f0-9]{40})/i)?.[1];
    if (!shaPattern.test(master || "")) throw new Error("无法识别当前 master SHA");

    // 只读取带 master 分支过滤条件的 CI Workflow 列表。
    // 不能混入当前页面的链接：当前页面可能是 PR/全部 Actions。
    const ids = new Set();
    for (let page = 1; page <= pages; page++) {
      const html = await request(`${root}/actions/workflows/ci.yml?` +
        new URLSearchParams({ query: "branch:master", page }));
      const { doc, roots } = embedded(html);
      const found = collectRunIds(doc, roots, html);
      for (const id of found) ids.add(id);
      console.log(`Actions 列表第 ${page} 页发现 ${found.size} 个 Run，合计 ${ids.size} 个`);
    }
    if (!ids.size) throw new Error(
      "Actions 页面未返回 Run 列表。请打开仓库 Actions → CI 页面，" +
      "等待运行列表显示，再在该页面的 Console 执行脚本。"
    );

    const details = [];
    for (const id of ids) {
      const detail = await getRunDetails(id);
      if (!detail.run) throw new Error(`Run ${id} 缺少完整元数据，无法安全确定最新旧 CI`);
      details.push(detail);
    }
    details.sort((a, b) => new Date(b.run.created) - new Date(a.run.created));
    const old = details.filter(({ run }) => run.branch === "master" &&
      run.event === "push" && run.path === ".github/workflows/ci.yml" &&
      run.sha !== master);
    const protectedIds = new Set(old.slice(0, preserveOld).map(({ run }) => run.id));
    const candidates = old.filter(({ run }) => !protectedIds.has(run.id) &&
      run.status === "queued" && run.attempt === 1).slice(0, maxRequests);

    // 只核验一轮完整 Job 清单，然后显示 Dry Run；发送前不逐项重复查询。
    const tasks = [];
    for (const { run, jobs } of candidates) {
      if (jobs && jobs.every(unstarted)) tasks.push(run);
      else console.warn(`保护 Run ${run.id}：Job 已执行或完整清单不可用`);
    }
    console.log(`master ${master}; 扫描 ${ids.size} 个 Run；候选 ${candidates.length}；安全可取消 ${tasks.length}`);
    console.table(tasks.map(run => ({ runId: run.id, suiteId: run.suiteId,
      commit: run.sha.slice(0, 12), created: run.created })));
    if (!tasks.length) return;
    if (!confirm(`Dry Run：发现 ${tasks.length} 个可取消的旧 master CI。\n确认现在发送取消请求？`)) return;

    window.xdriveStopCancel = false;
    let accepted = 0, failed = 0;
    for (const [index, run] of tasks.entries()) {
      if (window.xdriveStopCancel) break;
      try {
        const response = await fetch(`${root}/suites/${run.suiteId}/cancel`, {
          method: "PUT", credentials: "same-origin",
          headers: { accept: "application/json", "content-type": "application/json",
            "github-is-react": "true", "github-verified-fetch": "true",
            "x-requested-with": "XMLHttpRequest" },
          body: null
        });
        const text = await response.text();
        if (response.status === 200 && text.includes("successfully requested")) accepted++;
        else {
          failed++;
          console.warn(`Suite ${run.suiteId}: HTTP ${response.status}`, text.slice(0, 180));
          if ([401, 403, 429].includes(response.status)) break;
        }
      } catch (error) { failed++; console.error(error); break; }
      if ((index + 1) % 10 === 0) console.log(`已处理 ${index + 1}/${tasks.length}`);
      await sleep(intervalMs);
    }
    console.log(`结束：GitHub 接受 ${accepted}；失败 ${failed}。接受不代表已完成取消。`);
  } catch (error) {
    console.error("安全停止；未继续执行：", error);
  }
})();
