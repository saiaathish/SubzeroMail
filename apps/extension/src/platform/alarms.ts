import { getChrome } from "./chrome";

export const REMINDER_ALARM = "subzero-reminder-check";

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
