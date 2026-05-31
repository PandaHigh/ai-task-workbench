type TranslationTable = Record<string, Record<string, string>>;

const zh: TranslationTable = {
  common: {
    loading: "加载中...",
    error: "出错了",
    success: "成功",
    cancel: "取消",
    confirm: "确认",
    delete: "删除",
    save: "保存",
    edit: "编辑",
    add: "添加",
    close: "关闭",
    retry: "重试",
    download: "下载",
    share: "分享",
    back: "返回",
    status: "状态",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    pending: "等待中",
    paused: "已暂停",
    stopped: "已停止",
    progress: "进度",
    cost: "费用",
    time: "时间",
    budget: "预算",
    tasks: "任务",
    queue: "队列",
    logs: "日志",
    report: "报告",
    noData: "暂无数据",
    goals: "目标",
    settings: "设置",
  },
  evolution: {
    taskRunning: "任务执行中",
    taskComplete: "任务完成",
    taskFailed: "任务失败",
    noTraceData: "暂无 Trace 数据",
    traceDescription: "任务执行后将显示 Agent 执行时间线",
    budgetExhausted: "预算已用完",
    goalPursuing: "追踪中",
    goalAchieved: "已达成",
    goalUnmet: "进行中",
    addTask: "添加任务",
    deleteTask: "删除任务",
    runNewTask: "运行新任务",
    stopRun: "停止运行",
    evaluationCycles: "评估周期",
    totalCost: "总费用",
    elapsed: "已耗时",
    remainingGoals: "剩余目标",
    completedGoals: "已完成目标",
    viewReport: "查看报告",
    downloading: "下载中...",
    showingRecent: "显示最近 {visible} 条",
    totalLogs: "共 {total} 条",
  },
  wizard: {
    createTask: "创建任务",
    taskContent: "任务内容",
    workingDirectory: "工作目录",
    selectDirectory: "选择目录",
  },
};

const en: TranslationTable = {
  common: {
    loading: "Loading...",
    error: "Error",
    success: "Success",
    cancel: "Cancel",
    confirm: "Confirm",
    delete: "Delete",
    save: "Save",
    edit: "Edit",
    add: "Add",
    close: "Close",
    retry: "Retry",
    download: "Download",
    share: "Share",
    back: "Back",
    status: "Status",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    pending: "Pending",
    paused: "Paused",
    stopped: "Stopped",
    progress: "Progress",
    cost: "Cost",
    time: "Time",
    budget: "Budget",
    tasks: "Tasks",
    queue: "Queue",
    logs: "Logs",
    report: "Report",
    noData: "No data",
    goals: "Goals",
    settings: "Settings",
  },
  evolution: {
    taskRunning: "Task Running",
    taskComplete: "Task Complete",
    taskFailed: "Task Failed",
    noTraceData: "No Trace Data",
    traceDescription: "Agent execution timeline will appear after task starts",
    budgetExhausted: "Budget Exhausted",
    goalPursuing: "Pursuing",
    goalAchieved: "Achieved",
    goalUnmet: "In Progress",
    addTask: "Add Task",
    deleteTask: "Delete Task",
    runNewTask: "Run New Task",
    stopRun: "Stop Run",
    evaluationCycles: "Evaluation Cycles",
    totalCost: "Total Cost",
    elapsed: "Elapsed",
    remainingGoals: "Remaining Goals",
    completedGoals: "Completed Goals",
    viewReport: "View Report",
    downloading: "Downloading...",
    showingRecent: "Showing recent {visible}",
    totalLogs: "{total} total",
  },
  wizard: {
    createTask: "Create Task",
    taskContent: "Task Content",
    workingDirectory: "Working Directory",
    selectDirectory: "Select Directory",
  },
};

type Locale = "zh" | "en";
type Namespace = keyof typeof zh;

let currentLocale: Locale = "zh";

const tables: Record<Locale, TranslationTable> = { zh, en };

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(namespace: Namespace, key: string, params?: Record<string, string | number>): string {
  const table = tables[currentLocale]?.[namespace] ?? tables.zh[namespace];
  let text = table?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}
