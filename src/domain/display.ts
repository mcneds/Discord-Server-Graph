const CHANNEL_SUFFIX_MAX_LEN = 52;

const looksLikeChannelSuffix = (value: string): boolean => {
  const text = value.trim();
  if (!text || text.length > CHANNEL_SUFFIX_MAX_LEN) return false;

  const withoutEmoji = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "").trim();
  if (!withoutEmoji) return false;

  const hasChannelPunctuation = /[#/_-]/.test(withoutEmoji);
  const hasUpperCase = /[A-Z]/.test(withoutEmoji);
  const mostlyLowerCase = withoutEmoji === withoutEmoji.toLowerCase();

  return hasChannelPunctuation || !hasUpperCase || mostlyLowerCase;
};

export const splitScrapedServerName = (rawName: string): { serverName: string; channelName: string | null } => {
  const name = String(rawName ?? "").trim();
  if (!name) return { serverName: "Unknown Server", channelName: null };

  const separatorIndex = name.lastIndexOf(":");
  if (separatorIndex <= 0) return { serverName: name, channelName: null };

  const serverName = name.slice(0, separatorIndex).trim();
  const channelName = name.slice(separatorIndex + 1).trim();
  if (!serverName || !channelName || !looksLikeChannelSuffix(channelName)) {
    return { serverName: name, channelName: null };
  }

  return { serverName, channelName };
};

export const getServerDisplayName = (rawName: string, hideScrapedChannel = true): string => {
  if (!hideScrapedChannel) return String(rawName ?? "").trim() || "Unknown Server";
  return splitScrapedServerName(rawName).serverName;
};

export const getServerSearchText = (rawName: string): string => {
  const full = String(rawName ?? "").trim();
  const simplified = getServerDisplayName(full, true);
  return `${full} ${simplified}`.trim().toLowerCase();
};
