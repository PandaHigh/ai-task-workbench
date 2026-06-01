export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  eventPattern: string;
  channels: NotificationChannel[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
}

export type NotificationChannel =
  | { type: "websocket" }
  | { type: "webhook"; url: string }
  | { type: "email"; address: string }
  | { type: "slack"; webhookUrl: string }
  | { type: "telegram"; botToken: string; chatId: string };

export interface NotificationEvent {
  event: string;
  runId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export class NotificationEngine {
  private rules: NotificationRule[] = [];
  private quietHoursStart?: string;
  private quietHoursEnd?: string;

  setQuietHours(start?: string, end?: string): void {
    this.quietHoursStart = start;
    this.quietHoursEnd = end;
  }

  loadRules(rules: NotificationRule[]): void {
    this.rules = rules.filter((r) => r.enabled);
  }

  async dispatch(event: NotificationEvent): Promise<void> {
    const quiet = this.isQuietHours();
    for (const rule of this.rules) {
      if (!this.matchesPattern(event.event, rule.eventPattern)) continue;
      for (const channel of rule.channels) {
        if (quiet && channel.type !== "websocket") continue;
        try {
          await this.sendToChannel(channel, event);
        } catch (err) {
          console.warn(`[notification] Failed to send via ${channel.type}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }

  private matchesPattern(event: string, pattern: string): boolean {
    if (pattern === "*") return true;
    const regex = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    return regex.test(event);
  }

  private isQuietHours(): boolean {
    if (!this.quietHoursStart || !this.quietHoursEnd) return false;
    const now = new Date();
    const hour = now.getHours();
    const start = parseInt(this.quietHoursStart.split(":")[0], 10);
    const end = parseInt(this.quietHoursEnd.split(":")[0], 10);
    return start >= end ? (hour >= start || hour < end) : (hour >= start && hour < end);
  }

  private async sendToChannel(channel: NotificationChannel, event: NotificationEvent): Promise<void> {
    const payload = JSON.stringify({
      event: event.event,
      runId: event.runId,
      data: event.data,
      timestamp: event.timestamp,
    });

    switch (channel.type) {
      case "webhook":
        await fetch(channel.url, { method: "POST", body: payload, headers: { "Content-Type": "application/json" } });
        break;
      case "slack":
        await fetch(channel.webhookUrl, { method: "POST", body: JSON.stringify({ text: `[AI Workbench] ${event.event}: ${JSON.stringify(event.data)}` }), headers: { "Content-Type": "application/json" } });
        break;
      case "telegram":
        await fetch(`https://api.telegram.org/bot${channel.botToken}/sendMessage`, { method: "POST", body: JSON.stringify({ chat_id: channel.chatId, text: `[AI Workbench] ${event.event}` }), headers: { "Content-Type": "application/json" } });
        break;
      case "websocket":
        // WebSocket notifications are handled by the main server broadcast
        break;
      case "email":
        // Email requires external service integration
        console.info(`[notification] Email to ${channel.address}: ${event.event}`);
        break;
    }
  }
}
