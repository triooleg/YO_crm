export const taskChannelIcons = {
  FACEBOOK: "f",
  INSTAGRAM: "◎",
  WHATSAPP: "◉",
  CHATWOOT: "C",
  EMAIL: "✉",
} as const;

export type TaskChannel = keyof typeof taskChannelIcons;

type TaskChannelInput = {
  client?: { source?: string; preferredChannel?: string };
  sourceMessage?: { conversation: { channel: string } };
};

export function taskChannel(task: TaskChannelInput): TaskChannel | undefined {
  const channel = task.sourceMessage?.conversation.channel || task.client?.preferredChannel || task.client?.source;
  return channel && Object.hasOwn(taskChannelIcons, channel)
    ? channel as TaskChannel
    : undefined;
}
