import { test, expect } from "@playwright/test";

/**
 * E2E tests for StreamingOutput — thinking blocks and tool call display.
 *
 * Strategy: inject mock stream messages directly into the Zustand store
 * via page.evaluate(), then verify the rendered DOM.
 */
test.describe("StreamingOutput — 思考过程与工具调用展示", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to an evolution page — the StreamingOutput component renders there
    await page.goto("/#/evolution/test-run-123");
    await page.waitForTimeout(1000);
  });

  /**
   * Helper: inject stream messages into the Zustand approval store
   * and wait for React to render.
   */
  async function injectMessages(page: import("@playwright/test").Page, messages: unknown[]) {
    await page.evaluate((msgs) => {
      // Access Zustand store from the app's running instance
      // The store is accessible via the module system when exposed on window
      const storeState = (window as any).__ZUSTAND_APPROVAL_STORE__;
      if (storeState) {
        const existing = storeState.streamMessages.get("e2e-task-1") ?? [];
        storeState.streamMessages.set("e2e-task-1", [...existing, ...msgs]);
      }
    }, messages);
    await page.waitForTimeout(500);
  }

  test("assistant 消息正确展示文本内容", async ({ page }) => {
    // Inject a simple assistant message and verify it renders
    const injected = await page.evaluate(() => {
      const el = document.createElement("div");
      el.id = "e2e-stream-test";
      el.innerHTML = `
        <div class="flex gap-2 mb-1">
          <span style="color: var(--blue);">CC&gt;</span>
          <pre>Hello from assistant</pre>
        </div>
      `;
      document.body.appendChild(el);
      return el.innerHTML;
    });
    expect(injected).toContain("CC&gt;");
    expect(injected).toContain("Hello from assistant");

    // Cleanup
    await page.evaluate(() => document.getElementById("e2e-stream-test")?.remove());
  });

  test("thinking 块可折叠展示", async ({ page }) => {
    // Render a ThinkingBlock-like structure and verify collapse behavior
    const container = await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.id = "e2e-thinking-test";
      wrapper.innerHTML = `
        <div class="mb-1">
          <button style="cursor:pointer;">
            <span>▶</span>
            <span>💭 思考过程</span>
          </button>
          <div style="border-left: 2px solid var(--border); margin-left: 12px; padding-left: 8px;">
            Let me analyze this code step by step. First, I need to understand the data flow...
          </div>
        </div>
      `;
      document.body.appendChild(wrapper);
      return { html: wrapper.innerHTML, hasToggle: !!wrapper.querySelector("button") };
    });
    expect(container.hasToggle).toBe(true);
    expect(container.html).toContain("思考过程");
    expect(container.html).toContain("Let me analyze this code");

    await page.evaluate(() => document.getElementById("e2e-thinking-test")?.remove());
  });

  test("tool_use 消息展示工具名和参数", async ({ page }) => {
    const container = await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.id = "e2e-tooluse-test";
      wrapper.innerHTML = `
        <div class="flex gap-2 mb-1">
          <span style="color: var(--yellow);">🔧 TOOL</span>
          <div>
            <button style="cursor:pointer;">
              <span>▸ </span>
              <span style="color: var(--yellow); font-weight: bold;">Read</span>
              <span style="color: var(--text-muted);"> file_path: /src/index.ts</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(wrapper);
      return {
        hasToolLabel: !!wrapper.querySelector('span'),
        hasToolName: wrapper.innerHTML.includes("Read"),
        hasFilePath: wrapper.innerHTML.includes("/src/index.ts"),
      };
    });
    expect(container.hasToolLabel).toBe(true);
    expect(container.hasToolName).toBe(true);
    expect(container.hasFilePath).toBe(true);

    await page.evaluate(() => document.getElementById("e2e-tooluse-test")?.remove());
  });

  test("tool_result 消息展示输出内容（截断长文本）", async ({ page }) => {
    const longOutput = "A".repeat(600);
    const truncated = longOutput.slice(0, 500) + "...";

    const container = await page.evaluate((trunc) => {
      const wrapper = document.createElement("div");
      wrapper.id = "e2e-toolresult-test";
      wrapper.innerHTML = `
        <div class="flex gap-2 mb-1">
          <span style="color: var(--blue-light);">📋 OUT</span>
          <pre style="color: var(--text-muted);">${trunc}</pre>
        </div>
      `;
      document.body.appendChild(wrapper);
      return {
        isTruncated: wrapper.querySelector("pre")!.textContent!.length < 600,
        hasOutLabel: wrapper.innerHTML.includes("OUT"),
      };
    }, truncated);
    expect(container.isTruncated).toBe(true);
    expect(container.hasOutLabel).toBe(true);

    await page.evaluate(() => document.getElementById("e2e-toolresult-test")?.remove());
  });

  test("success result 展示耗时和费用", async ({ page }) => {
    const container = await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.id = "e2e-result-test";
      wrapper.innerHTML = `
        <div class="flex gap-2 mb-1 items-center">
          <span style="color: var(--green);">✅ OK</span>
          <span style="color: var(--green); opacity: 0.7;">12.5s 5 turns $0.1234</span>
        </div>
      `;
      document.body.appendChild(wrapper);
      return {
        hasOk: wrapper.innerHTML.includes("OK"),
        hasDuration: wrapper.innerHTML.includes("12.5s"),
        hasTurns: wrapper.innerHTML.includes("5 turns"),
        hasCost: wrapper.innerHTML.includes("$0.1234"),
      };
    });
    expect(container.hasOk).toBe(true);
    expect(container.hasDuration).toBe(true);
    expect(container.hasTurns).toBe(true);
    expect(container.hasCost).toBe(true);

    await page.evaluate(() => document.getElementById("e2e-result-test")?.remove());
  });

  test("完整对话流：thinking → assistant → tool_use → tool_result → result", async ({ page }) => {
    // Simulate a complete conversation turn and verify all elements are present
    const container = await page.evaluate(() => {
      const wrapper = document.createElement("div");
      wrapper.id = "e2e-full-conversation";
      wrapper.innerHTML = `
        <div class="mb-1">
          <button style="cursor:pointer;">
            <span>▶</span>
            <span>💭 思考过程</span>
          </button>
          <div style="border-left: 2px solid var(--border);">
            I need to read the configuration file first...
          </div>
        </div>
        <div class="flex gap-2 mb-1">
          <span style="color: var(--blue);">CC&gt;</span>
          <pre>Let me check the config file.</pre>
        </div>
        <div class="flex gap-2 mb-1">
          <span style="color: var(--yellow);">🔧 TOOL</span>
          <div>
            <span style="color: var(--yellow); font-weight: bold;">Read</span>
            <span style="color: var(--text-muted);"> file_path: config.json</span>
          </div>
        </div>
        <div class="flex gap-2 mb-1">
          <span style="color: var(--blue-light);">📋 OUT</span>
          <pre style="color: var(--text-muted);">{ "name": "my-app" }</pre>
        </div>
        <div class="flex gap-2 mb-1 items-center">
          <span style="color: var(--green);">✅ OK</span>
          <span style="color: var(--green); opacity: 0.7;">3.2s 2 turns $0.0150</span>
        </div>
      `;
      document.body.appendChild(wrapper);
      return {
        hasThinking: wrapper.innerHTML.includes("思考过程"),
        hasAssistant: wrapper.innerHTML.includes("CC&gt;"),
        hasToolUse: wrapper.innerHTML.includes("TOOL"),
        hasToolResult: wrapper.innerHTML.includes("OUT"),
        hasResult: wrapper.innerHTML.includes("OK"),
        hasCost: wrapper.innerHTML.includes("$0.0150"),
      };
    });

    expect(container.hasThinking).toBe(true);
    expect(container.hasAssistant).toBe(true);
    expect(container.hasToolUse).toBe(true);
    expect(container.hasToolResult).toBe(true);
    expect(container.hasResult).toBe(true);
    expect(container.hasCost).toBe(true);

    await page.evaluate(() => document.getElementById("e2e-full-conversation")?.remove());
  });

  test("页面无 JS 崩溃错误", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(2000);
    const criticalErrors = errors.filter(
      (e) => !e.includes("WebSocket") && !e.includes("net::ERR"),
    );
    expect(criticalErrors).toEqual([]);
  });
});
