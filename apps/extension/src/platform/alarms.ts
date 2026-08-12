import { getChrome } from "./chrome";

export const DEMO_SYNC_ALARM = "subzero-demo-sync";
export const REMINDER_ALARM = "subzero-reminder-check";

export async function scheduleDemoSyncAlarm(): Promise<boolean> {
  const alarms = getChrome()?.alarms;
  if (!alarms) return false;

  try {
    await alarms.create(DEMO_SYNC_ALARM, { periodInMinutes: 15 });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleReminderAlarm(
  dueAt: string | null,
): Promise<boolean> {
  const alarms = getChrome()?.alarms;
  if (!alarms || !dueAt) return false;

  const delayInMinutes = Math.max(
    1,
    Math.ceil((new Date(dueAt).getTime() - Date.now()) / 60_000),
  );
  try {
    await alarms.create(REMINDER_ALARM, { delayInMinutes });
    return true;
  } catch {
    return false;
  }
}
