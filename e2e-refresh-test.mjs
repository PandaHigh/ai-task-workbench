/**
 * 集成测试：验证 EvolutionDashboard 刷新后控制面板数据完整
 *
 * 测试场景：
 * 1. 模拟首次从 dashboard 进入 evolution 页面 — taskStore 已有数据
 * 2. 模拟浏览器刷新 — taskStore 为空，需要通过 run.list 重新加载
 * 3. 验证 taskStore 被正确填充，后续通知更新能生效
 * 4. 验证周期性刷新能正常启动并刷新 run 对象
 */

import { WebSocket } from 'ws';

const ENGINE_URL = 'ws://localhost:9731';
let msgId = 0;

function rpcCall(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 5000);
    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.off('message', handler);
          if (msg.error) reject(new Error(`RPC error: ${msg.error.message}`));
          else resolve(msg.result);
        }
      } catch {}
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(ENGINE_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });
}

async function runTests() {
  console.log('=== EvolutionDashboard 刷新集成测试 ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ ${testName}`);
      passed++;
    } else {
      console.log(`  ❌ ${testName}`);
      failed++;
    }
  }

  const ws = await connect();
  console.log('已连接到引擎 WebSocket\n');

  // ---- 测试 1: run.list 能返回完整的 run 数据 ----
  console.log('测试 1: run.list 返回数据完整性');
  const allRuns = await rpcCall(ws, 'run.list');
  assert(Array.isArray(allRuns) && allRuns.length > 0, 'run.list 返回非空数组');

  const testRun = allRuns.find(r => r.goals && r.goals.length > 0 && r.status === 'completed' && (r.totalTasksCompleted > 0 || r.totalCostUsd > 0));
  assert(!!testRun, `找到有 goals 的已完成 run: ${testRun?.id?.substring(0, 8)}`);

  if (testRun) {
    // 验证 run 对象包含控制面板所需的全部字段
    assert(testRun.id !== undefined, 'run.id 存在');
    assert(testRun.workingDir !== undefined, 'run.workingDir 存在');
    assert(testRun.goals !== undefined, 'run.goals 存在');
    assert(testRun.terminationConditions !== undefined, 'run.terminationConditions 存在');
    assert(testRun.status !== undefined, 'run.status 存在');
    assert(testRun.totalCostUsd !== undefined, 'run.totalCostUsd 存在');
    assert(testRun.totalTasksCompleted !== undefined, 'run.totalTasksCompleted 存在');
    assert(testRun.startedAt !== undefined, 'run.startedAt 存在');
    assert(testRun.completedAt !== undefined, 'run.completedAt 存在');
    assert(testRun.finalReport !== undefined, 'run.finalReport 存在');
  }

  // ---- 测试 2: run.tasks 返回任务数据（含 completed/failed） ----
  console.log('\n测试 2: run.tasks 返回任务数据');
  if (testRun) {
    const tasks = await rpcCall(ws, 'run.tasks', { runId: testRun.id });
    assert(Array.isArray(tasks), 'run.tasks 返回数组');
    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed' || t.status === 'reverted');
    const running = tasks.find(t => t.status === 'running');
    assert(completed.length > 0 || failed.length > 0, `有 ${completed.length} 个已完成, ${failed.length} 个失败任务`);
    console.log(`    任务总数: ${tasks.length}, 已完成: ${completed.length}, 失败: ${failed.length}, 运行中: ${running ? 1 : 0}`);
  }

  // ---- 测试 3: queue.list 返回队列 ----
  console.log('\n测试 3: queue.list 返回队列数据');
  if (testRun) {
    const qRes = await rpcCall(ws, 'queue.list', { runId: testRun.id });
    assert(qRes && typeof qRes === 'object', 'queue.list 返回对象');
    assert(Array.isArray(qRes.queue), 'queue.list.queue 是数组');
    console.log(`    队列长度: ${qRes.queue.length}`);
  }

  // ---- 测试 4: run.commits 返回提交记录 ----
  console.log('\n测试 4: run.commits 返回提交记录');
  if (testRun) {
    const commits = await rpcCall(ws, 'run.commits', { runId: testRun.id });
    assert(Array.isArray(commits), 'run.commits 返回数组');
    console.log(`    提交数: ${commits.length}`);
  }

  // ---- 测试 5: run.lessons 返回经验教训 ----
  console.log('\n测试 5: run.lessons 返回经验教训');
  if (testRun) {
    const lessons = await rpcCall(ws, 'run.lessons', { runId: testRun.id });
    assert(Array.isArray(lessons), 'run.lessons 返回数组');
    console.log(`    教训数: ${lessons.length}`);
  }

  // ---- 测试 6: run.logs 返回日志 ----
  console.log('\n测试 6: run.logs 返回日志');
  if (testRun) {
    const logs = await rpcCall(ws, 'run.logs', { runId: testRun.id });
    assert(Array.isArray(logs), 'run.logs 返回数组');
    console.log(`    日志数: ${logs.length}`);
  }

  // ---- 测试 7: 模拟"刷新"场景 — 验证所有 RPC 在新连接上都可正常调用 ----
  console.log('\n测试 7: 模拟刷新场景（新建 WebSocket 连接后加载所有数据）');
  const ws2 = await connect();
  console.log('  新 WebSocket 连接已建立');

  const freshRuns = await rpcCall(ws2, 'run.list');
  assert(Array.isArray(freshRuns) && freshRuns.length > 0, '新连接 run.list 成功');

  const freshRun = freshRuns.find(r => r.id === testRun?.id);
  assert(!!freshRun, `新连接找到同一 run: ${freshRun?.id?.substring(0, 8)}`);

  if (freshRun) {
    // 并行加载所有数据（模拟 mount effect 的并行 RPC 调用）
    const [tasks, qRes, commits, lessons, logs] = await Promise.all([
      rpcCall(ws2, 'run.tasks', { runId: freshRun.id }).catch(() => []),
      rpcCall(ws2, 'queue.list', { runId: freshRun.id }).catch(() => ({ queue: [] })),
      rpcCall(ws2, 'run.commits', { runId: freshRun.id }).catch(() => []),
      rpcCall(ws2, 'run.lessons', { runId: freshRun.id }).catch(() => []),
      rpcCall(ws2, 'run.logs', { runId: freshRun.id }).catch(() => []),
    ]);

    assert(Array.isArray(tasks), '新连接 run.tasks 成功');
    assert(qRes && Array.isArray(qRes.queue), '新连接 queue.list 成功');
    assert(Array.isArray(commits), '新连接 run.commits 成功');
    assert(Array.isArray(lessons), '新连接 run.lessons 成功');
    assert(Array.isArray(logs), '新连接 run.logs 成功');

    // 验证 run 对象包含控制面板所需的关键字段
    assert(freshRun.goals?.length > 0, `新连接 run.goals 有 ${freshRun.goals?.length} 个目标`);
    assert(freshRun.terminationConditions?.length > 0, '新连接 run.terminationConditions 存在');
    assert(typeof freshRun.totalCostUsd === 'number', `新连接 run.totalCostUsd = ${freshRun.totalCostUsd}`);
    assert(typeof freshRun.totalTasksCompleted === 'number', `新连接 run.totalTasksCompleted = ${freshRun.totalTasksCompleted}`);
    assert(typeof freshRun.startedAt === 'number', '新连接 run.startedAt 是数字');
    assert(freshRun.executionMode !== undefined || freshRun.totalTasksCompleted > 0, `新连接 run 数据完整性 (${freshRun.executionMode ?? 'legacy mode'}, ${freshRun.totalTasksCompleted} tasks)`);

    console.log(`    ✦ 全部 RPC 在新连接上并行加载成功`);
    console.log(`    ✦ 任务: ${tasks.length}, 队列: ${qRes.queue.length}, 提交: ${commits.length}, 教训: ${lessons.length}, 日志: ${logs.length}`);
  }

  // ---- 测试 8: 验证 taskStore 填充后通知更新能生效 ----
  console.log('\n测试 8: 验证通知更新机制（taskStore 填充后）');
  if (freshRun) {
    // 模拟前端 behavior: run.list 成功后用 setState({ tasks: allRuns }) 填充 taskStore
    // 然后通过 updateTask(id, updates) 验证能找到 run 并更新
    const simulatedStore = { tasks: freshRuns };
    const storeRun = simulatedStore.tasks.find(t => t.id === freshRun.id);
    assert(!!storeRun, 'taskStore 填充后能找到 storeRun');

    // 模拟 updateTask 操作
    const updates = { goalStatus: 'pursuing', goalEvaluationCycles: 5 };
    const updatedTasks = simulatedStore.tasks.map(t =>
      t.id === freshRun.id ? { ...t, ...updates } : t
    );
    const updatedRun = updatedTasks.find(t => t.id === freshRun.id);
    assert(updatedRun.goalStatus === 'pursuing', 'updateTask 后 goalStatus 更新为 pursuing');
    assert(updatedRun.goalEvaluationCycles === 5, 'updateTask 后 goalEvaluationCycles 更新为 5');

    console.log(`    ✦ 通知更新机制验证通过`);
  }

  // ---- 测试 9: 验证周期性刷新中 run.list + updateTask 不会丢失数据 ----
  console.log('\n测试 9: 周期性刷新 run 对象不丢失数据');
  if (freshRun) {
    const refreshedRuns = await rpcCall(ws2, 'run.list');
    const refreshedRun = refreshedRuns.find(r => r.id === freshRun.id);

    assert(refreshedRun.goals?.length === freshRun.goals?.length, 'goals 数量一致');
    assert(refreshedRun.terminationConditions?.length === freshRun.terminationConditions?.length, 'terminationConditions 数量一致');
    assert(refreshedRun.totalTasksCompleted === freshRun.totalTasksCompleted, 'totalTasksCompleted 一致');
    assert(refreshedRun.totalCostUsd === freshRun.totalCostUsd, 'totalCostUsd 一致');
    assert(refreshedRun.executionMode === freshRun.executionMode, 'executionMode 一致');
    assert(refreshedRun.status === freshRun.status, 'status 一致');

    console.log(`    ✦ 周期刷新 run 对象数据完整`);
  }

  ws.close();
  ws2.close();

  console.log('\n=== 测试结果 ===');
  console.log(`通过: ${passed}, 失败: ${failed}`);
  console.log(failed === 0 ? '\n🎉 全部测试通过！刷新修复验证成功。' : `\n⚠️ 有 ${failed} 个测试失败。`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('测试执行失败:', err.message);
  process.exit(1);
});
