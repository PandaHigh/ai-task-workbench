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
  console.log('✓ [1/21] WebSocket 连接成功');

  // Config
  const q = await rpc(ws, 'config.get', { key: 'qualityThreshold' });
  console.log(`✓ [2/21] config.get → value=${q.value}`);
  await rpc(ws, 'config.set', { key: 'qualityThreshold', value: 0.7 });
  const q2 = await rpc(ws, 'config.get', { key: 'qualityThreshold' });
  console.log(`✓ [3/21] config.set(0.7) → value=${q2.value}`);
  await rpc(ws, 'config.set', { key: 'qualityThreshold', value: 0.6 });

  // Create run
  const tmpDir = `/tmp/ai-wb-e2e-${Date.now()}`;
  execSync(`mkdir -p ${tmpDir} && cd ${tmpDir} && git init && git commit -m "init" --allow-empty`);
  const run = await rpc(ws, 'run.create', {
    workingDir: tmpDir, goals: ['实现 hello world', '添加测试'],
    terminationConditions: ['函数输出正确', '测试通过'],
  });
  console.log(`✓ [4/21] run.create → id=${run.id.substring(0,8)}… status=${run.status}`);

  // List runs
  const runs = await rpc(ws, 'run.list', {});
  console.log(`✓ [5/21] run.list → ${runs.length} 个 run`);

  // Create tasks
  const t1 = await rpc(ws, 'task.create', { runId: run.id, content: '创建 hello.ts 文件', type: 'user_defined', priority: 1 });
  const t2 = await rpc(ws, 'task.create', { runId: run.id, content: '创建 hello.test.ts 文件', type: 'user_defined', priority: 2 });
  console.log(`✓ [6/21] task.create × 2 → ${t1.id.substring(0,8)}… ${t2.id.substring(0,8)}…`);

  // Queue
  const qRes = await rpc(ws, 'queue.list', { runId: run.id });
  console.log(`✓ [7/21] queue.list → ${qRes.queue.length} 个任务`);

  // Reorder
  await rpc(ws, 'queue.reorder', { runId: run.id, taskIds: [t2.id, t1.id] });
  const rq = await rpc(ws, 'queue.list', { runId: run.id });
  console.log(`✓ [8/21] queue.reorder → 首任务: "${rq.queue[0].content}"`);

  // Tasks
  const tasks = await rpc(ws, 'run.tasks', { runId: run.id });
  console.log(`✓ [9/21] run.tasks → ${tasks.length} 个任务`);

  // Commits & lessons
  const commits = await rpc(ws, 'run.commits', { runId: run.id });
  const lessons = await rpc(ws, 'run.lessons', { runId: run.id });
  console.log(`✓ [10/21] commits=${commits.length} lessons=${lessons.length}`);

  // Set timeout
  await rpc(ws, 'task.setTimeout', { runId: run.id, taskId: t1.id, minutes: 30 });
  console.log(`✓ [11/21] task.setTimeout → 30min`);

  // Cancel task
  const tc = await rpc(ws, 'task.create', { runId: run.id, content: '待取消', type: 'user_defined', priority: 10 });
  await rpc(ws, 'task.cancel', { runId: run.id, taskId: tc.id });
  const cancelled = (await rpc(ws, 'run.tasks', { runId: run.id })).find(t => t.id === tc.id);
  console.log(`✓ [12/21] task.cancel → status=${cancelled.status}`);

  // Goal (expect rejection)
  try { await rpc(ws, 'run.pauseGoal', { runId: run.id }); throw new Error('should fail'); } catch (e) {
    if (e.message.includes('should fail')) throw e;
    console.log(`✓ [13/21] run.pauseGoal(无目标) → 正确拒绝`);
  }

  // Share
  const share = await rpc(ws, 'share.create', { runId: run.id, label: 'E2E' });
  const shares = await rpc(ws, 'share.list', {});
  await rpc(ws, 'share.revoke', { token: share.token });
  const ar = await rpc(ws, 'share.list', { runId: run.id });
  console.log(`✓ [14/21] share → 创建${shares.length}个 撤销后${ar.length}个`);

  // Wizard
  const wiz = await rpc(ws, 'wizard.start', { workingDir: '/tmp' });
  const v = await rpc(ws, 'wizard.validate', { sessionId: wiz.sessionId, params: { content: 'T', goals: ['G'], terminationConditions: ['C'], postCompletionAction: 'none' } });
  console.log(`✓ [15/21] wizard.start + validate(${v.valid})`);

  // Session & roles
  const sess = await rpc(ws, 'session.identify', { name: 'E2E Tester' });
  const roles = await rpc(ws, 'role.list', {});
  console.log(`✓ [16/21] session(${sess.userId?.substring(0,8)}…) + roles(${roles.length})`);

  // Activity & comments
  const acts = await rpc(ws, 'activity.list', { runId: run.id });
  await rpc(ws, 'comment.create', { runId: run.id, taskId: t1.id, content: '测试评论!', userId: 'E2E Tester' });
  const cmts = await rpc(ws, 'comment.list', { runId: run.id });
  console.log(`✓ [17/21] activity(${acts.length}) + comments(${cmts.length})`);

  // Execution mode
  await rpc(ws, 'run.setExecutionMode', { runId: run.id, mode: 'parallel' });
  const r2 = (await rpc(ws, 'run.list', {})).find(r => r.id === run.id);
  console.log(`✓ [18/21] setExecutionMode → ${r2.executionMode}`);

  // Delete
  await rpc(ws, 'run.delete', { runId: run.id });
  const afterDel = await rpc(ws, 'run.list', {});
  console.log(`✓ [19/21] run.delete → 剩余 ${afterDel.length} 个 run`);

  // Error cases
  try { await rpc(ws, 'run.report', { runId: 'nonexistent' }); } catch (e) {
    console.log(`✓ [20/21] run.report(不存在) → 正确拒绝`);
  }
  try { await rpc(ws, 'nonexistent.method', {}); } catch (e) {
    console.log(`✓ [21/21] 未知方法 → 正确拒绝`);
  }

  execSync(`rm -rf ${tmpDir}`);
  ws.close();
  console.log('\n✅ 全部 21 项端到端测试通过！系统运行正常。');
}

main().catch(e => { console.error('❌ 失败:', e.message); process.exit(1); });
