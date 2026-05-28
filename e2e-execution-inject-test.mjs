import ws from 'ws';
const WebSocket = ws.WebSocket || ws.default || ws;
import { execSync } from 'child_process';

const WS = 'ws://localhost:9731';
let mid = 1;
function rpc(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = mid++;
    const t = setTimeout(() => reject(new Error(`Timeout: ${method}`)), 10000);
    const h = (d) => { try { const m = JSON.parse(d.toString()); if (m.id === id) { clearTimeout(t); ws.off('message', h); m.error ? reject(new Error(`RPC[${method}]: ${JSON.stringify(m.error)}`)) : resolve(m.result); } } catch {} };
    ws.on('message', h);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

async function main() {
  const ws = new WebSocket(WS);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  console.log('✓ [1/24] WebSocket 连接成功');

  // Create run for testing
  const tmpDir = `/tmp/ai-wb-e2e-exec-${Date.now()}`;
  execSync(`mkdir -p ${tmpDir} && cd ${tmpDir} && git init && git commit -m "init" --allow-empty`);
  const run = await rpc(ws, 'run.create', {
    workingDir: tmpDir, goals: ['E2E execution mode test'],
    terminationConditions: ['Test passes'],
  });
  console.log(`✓ [2/24] run.create → id=${run.id.substring(0, 8)}`);

  // ─── Execution Mode E2E ──────────────────────────────────────────

  // Default should be undefined (no mode set)
  const initialRuns = await rpc(ws, 'run.list', {});
  const initialRun = initialRuns.find(r => r.id === run.id);
  console.log(`✓ [3/24] 初始执行模式: ${initialRun.executionMode || '(undefined/sequential)'}`);

  // Set to parallel
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'parallel' });
  const parallelRuns = await rpc(ws, 'run.list', {});
  const parallelRun = parallelRuns.find(r => r.id === run.id);
  if (parallelRun.executionMode !== 'parallel') throw new Error(`Expected parallel, got ${parallelRun.executionMode}`);
  console.log(`✓ [4/24] setExecutionMode(parallel) → ${parallelRun.executionMode}`);

  // Set to sequential
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'sequential' });
  const seqRuns = await rpc(ws, 'run.list', {});
  const seqRun = seqRuns.find(r => r.id === run.id);
  if (seqRun.executionMode !== 'sequential') throw new Error(`Expected sequential, got ${seqRun.executionMode}`);
  console.log(`✓ [5/24] setExecutionMode(sequential) → ${seqRun.executionMode}`);

  // Switch back to parallel for report check
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'parallel' });
  const report = await rpc(ws, 'run.report', { runId: run.id });
  if (report.run.executionMode !== 'parallel') throw new Error(`Report should show parallel, got ${report.run.executionMode}`);
  console.log(`✓ [6/24] run.report 确认持久化 → executionMode=${report.run.executionMode}`);

  // Reject invalid mode
  try {
    await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'invalid_mode' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [7/24] 无效模式被正确拒绝`);
  }

  // Reject nonexistent run
  try {
    await rpc(ws, 'run.setExecutionMode', { runId: 'nonexistent-run-id', mode: 'parallel' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [8/24] 不存在的 run 被正确拒绝`);
  }

  // Reject path traversal
  try {
    await rpc(ws, 'run.setExecutionMode', { runId: '../etc/passwd', mode: 'parallel' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [9/24] 路径遍历被正确拒绝`);
  }

  // Verify maxConcurrentAgents can be set
  const reportBefore = await rpc(ws, 'run.report', { runId: run.id });
  console.log(`✓ [10/24] maxConcurrentAgents: ${reportBefore.run.maxConcurrentAgents || '(default)'}`);

  // Multiple rapid switches (stress test optimistic update)
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'sequential' });
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'parallel' });
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'sequential' });
  const finalRuns = await rpc(ws, 'run.list', {});
  const finalRun = finalRuns.find(r => r.id === run.id);
  if (finalRun.executionMode !== 'sequential') throw new Error(`Expected sequential after rapid switches, got ${finalRun.executionMode}`);
  console.log(`✓ [11/24] 快速切换 3 次 → 最终状态: ${finalRun.executionMode}`);

  // ─── Inject Instructions E2E ──────────────────────────────────────

  // Reject without active executor
  try {
    await rpc(ws, 'approval.inject', { runId: run.id, instructions: 'test instruction' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [12/24] 无活跃 executor 时注入被正确拒绝`);
  }

  // Reject missing instructions
  try {
    await rpc(ws, 'approval.inject', { runId: run.id });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [13/24] 缺少 instructions 被正确拒绝`);
  }

  // Reject empty instructions
  try {
    await rpc(ws, 'approval.inject', { runId: run.id, instructions: '' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [14/24] 空 instructions 被正确拒绝`);
  }

  // Reject path traversal
  try {
    await rpc(ws, 'approval.inject', { runId: '../../../etc', instructions: 'test' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [15/24] 路径遍历 runId 被正确拒绝`);
  }

  // Reject nonexistent runId
  try {
    await rpc(ws, 'approval.inject', { runId: 'nonexistent', instructions: 'test' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [16/24] 不存在的 runId 被正确拒绝`);
  }

  // Start a run to create an active executor, then test injection
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'sequential' });
  const startResult = await rpc(ws, 'task.start', { runId: run.id });
  console.log(`✓ [17/24] task.start → status=${startResult.status}`);

  // Now inject should work
  const injectResult = await rpc(ws, 'approval.inject', { runId: run.id, instructions: 'E2E 测试：优先处理错误处理逻辑' });
  if (!injectResult.injected) throw new Error('Expected injected=true');
  console.log(`✓ [18/24] approval.inject → injected=${injectResult.injected}`);

  // Inject multiple instructions
  const inject2 = await rpc(ws, 'approval.inject', { runId: run.id, instructions: '使用 TypeScript strict mode' });
  if (!inject2.injected) throw new Error('Expected injected=true');
  console.log(`✓ [19/24] approval.inject(第二条) → injected=${inject2.injected}`);

  // Stop the run
  await rpc(ws, 'run.stop', { runId: run.id });
  console.log(`✓ [20/24] run.stop 停止执行器`);

  // Inject should fail again after stop
  try {
    await rpc(ws, 'approval.inject', { runId: run.id, instructions: 'after stop' });
    throw new Error('Should have failed');
  } catch (e) {
    if (e.message.includes('Should have failed')) throw e;
    console.log(`✓ [21/24] 停止后注入被正确拒绝`);
  }

  // ─── Cross-feature: execution mode preserved after stop ───────────

  const afterStopRuns = await rpc(ws, 'run.list', {});
  const afterStopRun = afterStopRuns.find(r => r.id === run.id);
  if (afterStopRun.executionMode !== 'sequential') throw new Error(`Mode should be preserved as sequential, got ${afterStopRun.executionMode}`);
  console.log(`✓ [22/24] 停止后执行模式保持不变: ${afterStopRun.executionMode}`);

  // ─── Verify run still has injected instruction logs ───────────────

  const logs = await rpc(ws, 'run.logs', { runId: run.id });
  const injectLogs = logs.filter(l => l.message && l.message.includes('Instructions injected'));
  if (injectLogs.length < 2) throw new Error(`Expected at least 2 inject logs, got ${injectLogs.length}`);
  console.log(`✓ [23/24] 日志中有 ${injectLogs.length} 条注入记录`);

  // Cleanup
  await rpc(ws, 'run.delete', { runId: run.id });
  execSync(`rm -rf ${tmpDir}`);
  console.log(`✓ [24/24] 清理完成`);

  ws.close();
  console.log('\n✅ 全部 24 项端到端测试通过！执行模式 & 注入指令功能正常。');
}

main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });
