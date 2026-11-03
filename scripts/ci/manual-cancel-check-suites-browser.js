(async () => {
  const root = "/lazyxu/xdrive";
  const cancelPR = true;       // false：只清理旧 master CI
  const intervalMs = 600;      // 每次请求之间间隔 600ms
  const maxRequests = 250;

  // 最新核对的旧 master CI Check Suite ID
  const masterSuites = `
112671313518 112671185252 112671175713 112671073805
112671042757 112671027679 112670944672 112670875994
112670854313 112670764995 112670643493 112670516903
112663251282 112657782968 112655180684 112654648296
112654431944 112654248105 112654210011 112608965822
112608616748 112608356930 112607981584
  `;

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
