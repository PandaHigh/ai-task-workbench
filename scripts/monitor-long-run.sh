#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# AI Task Workbench — 7×24 长时运行监控脚本
#
# 使用方式:
#   1. 先启动引擎: cd src-engine && npx tsx src/index.ts
#   2. 通过 UI 或 API 创建 run 并启动
#   3. 在另一个终端运行: bash scripts/monitor-long-run.sh
#
# 监控指标:
#   - Node.js 进程内存 (RSS)
#   - claude 子进程数量
#   - 评估循环次数 (从日志中提取)
#   - 任务完成/失败统计
#   - 累计花费
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

INTERVAL=${1:-30}  # 默认每 30 秒采样一次
DATA_DIR="$HOME/Library/Application Support/ai-task-workbench"
ENGINE_PID=""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo -e "${CYAN}  AI Task Workbench — 7×24 运行监控${NC}"
echo -e "${CYAN}  采样间隔: ${INTERVAL}s | 数据目录: ${DATA_DIR}${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════${NC}"
echo ""

# 找到引擎进程
find_engine_pid() {
  ENGINE_PID=$(pgrep -f "tsx src/index.ts" | head -1 || true)
  if [[ -z "$ENGINE_PID" ]]; then
    ENGINE_PID=$(pgrep -f "node.*engine" | head -1 || true)
  fi
}

# 获取 claude 子进程数
count_claude_processes() {
  pgrep -f "claude -p" 2>/dev/null | wc -l | tr -d ' '
}

# 获取进程内存 (MB)
get_memory_mb() {
  local pid=$1
  if [[ -n "$pid" && -d "/proc/$pid" ]]; then
    # Linux
    local rss_kb=$(cat /proc/$pid/status 2>/dev/null | grep VmRSS | awk '{print $2}')
    echo $((rss_kb / 1024))
  elif [[ -n "$pid" ]]; then
    # macOS
    ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0f", $1/1024}' || echo "0"
  else
    echo "0"
  fi
}

# 从 index.json 提取 run 信息
get_run_stats() {
  local index_file="$DATA_DIR/runs/index.json"
  if [[ ! -f "$index_file" ]]; then
    echo "NO_RUNS"
    return
  fi

  # 用 python 解析 JSON (更可靠)
  python3 -c "
import json, sys
try:
    with open('$index_file') as f:
        runs = json.load(f)
    for run in runs:
        if run.get('status') == 'running':
            print(f\"RUN_ID={run['id']}\")
            print(f\"COST=\${run.get('totalCostUsd', 0):.4f}\")
            print(f\"TASKS_COMPLETED={run.get('totalTasksCompleted', 0)}\")
            # Count tasks by status
            tasks_file = '$DATA_DIR/runs/' + run['id'] + '/tasks.json'
            try:
                with open(tasks_file) as tf:
                    tasks = json.load(tf)
                failed = sum(1 for t in tasks if t.get('status') == 'failed')
                reverted = sum(1 for t in tasks if t.get('status') == 'reverted')
                pending = sum(1 for t in tasks if t.get('status') == 'pending')
                running = sum(1 for t in tasks if t.get('status') == 'running')
                total = len(tasks)
                print(f'TASKS_TOTAL={total}')
                print(f'TASKS_FAILED={failed}')
                print(f'TASKS_REVERTED={reverted}')
                print(f'TASKS_PENDING={pending}')
                print(f'TASKS_RUNNING={running}')
            except:
                print(f'TASKS_TOTAL=0')
            break
    else:
        print('NO_ACTIVE_RUN')
except Exception as e:
    print(f'ERROR={e}')
" 2>/dev/null
}

# 从日志提取最近的评估循环数
get_eval_cycles() {
  local log_file="$1"
  if [[ ! -f "$log_file" ]]; then
    echo "?"
    return
  fi
  grep "evaluating goals" "$log_file" 2>/dev/null | tail -1 | grep -oP 'cycle \K\d+' || echo "?"
}

# 主循环
echo -e "$(date '+%H:%M:%S') ${GREEN}监控启动${NC} (Ctrl+C 停止)"
echo ""

SAMPLE_COUNT=0
while true; do
  find_engine_pid

  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
  TIMESTAMP=$(date '+%H:%M:%S')

  # 进程状态
  if [[ -n "$ENGINE_PID" ]]; then
    ENGINE_MEM=$(get_memory_mb "$ENGINE_PID")
    CLAUDE_COUNT=$(count_claude_processes)
    ENGINE_STATUS="${GREEN}在线${NC} (PID: $ENGINE_PID, 内存: ${ENGINE_MEM}MB)"
  else
    ENGINE_STATUS="${RED}离线${NC}"
    CLAUDE_COUNT=0
    ENGINE_MEM=0
  fi

  # Run 统计
  RUN_STATS=$(get_run_stats)
  if [[ "$RUN_STATS" == *"NO_ACTIVE_RUN"* || "$RUN_STATS" == *"NO_RUNS"* ]]; then
    RUN_INFO="${YELLOW}无活跃 Run${NC}"
  elif [[ "$RUN_STATS" == *"ERROR="* ]]; then
    RUN_INFO="${RED}解析错误${NC}"
  else
    RUN_ID=$(echo "$RUN_STATS" | grep "^RUN_ID=" | cut -d= -f2)
    COST=$(echo "$RUN_STATS" | grep "^COST=" | cut -d= -f2)
    COMPLETED=$(echo "$RUN_STATS" | grep "^TASKS_COMPLETED=" | cut -d= -f2)
    TOTAL=$(echo "$RUN_STATS" | grep "^TASKS_TOTAL=" | cut -d= -f2)
    FAILED=$(echo "$RUN_STATS" | grep "^TASKS_FAILED=" | cut -d= -f2)
    REVERTED=$(echo "$RUN_STATS" | grep "^TASKS_REVERTED=" | cut -d= -f2)
    PENDING=$(echo "$RUN_STATS" | grep "^TASKS_PENDING=" | cut -d= -f2)
    RUNNING=$(echo "$RUN_STATS" | grep "^TASKS_RUNNING=" | cut -d= -f2)

    # 评估循环
    LOG_FILE="$DATA_DIR/runs/$RUN_ID/logs.json"
    EVAL_CYCLE=$(get_eval_cycles "$LOG_FILE")

    RUN_INFO="${CYAN}${RUN_ID:0:8}...${NC} | 任务: ${COMPLETED}/${TOTAL} 完成, ${FAILED} 失败, ${REVERTED} revert, ${PENDING} 待处理 | 循环: ${EVAL_CYCLE} | 花费: \$${COST}"
  fi

  # 输出一行监控
  echo -e "[${TIMESTAMP}] #${SAMPLE_COUNT} 引擎: ${ENGINE_STATUS} | CC进程: ${CLAUDE_COUNT} | ${RUN_INFO}"

  # 内存告警
  if [[ -n "$ENGINE_PID" && "$ENGINE_MEM" -gt 500 ]]; then
    echo -e "  ${RED}⚠ 内存告警: RSS=${ENGINE_MEM}MB 超过 500MB 阈值${NC}"
  fi

  # CC 进程告警
  if [[ "$CLAUDE_COUNT" -gt 5 ]]; then
    echo -e "  ${YELLOW}⚠ CC 进程数量异常: ${CLAUDE_COUNT} 个 claude 进程在运行${NC}"
  fi

  sleep "$INTERVAL"
done
