// Opt-in release configuration; ordinary/test builds remain disabled.
const base = require("./package.json").build;
const config = require("./updates-config.json");
if (config.enabled !== true) throw new Error("Configure updates-config.json before preparing a signed update release.");
const arch = process.argv.includes("--arm64") ? "arm64" : process.argv.includes("--x64") ? "x64" : process.arch;
if (config.target !== `${process.platform}-${arch}`)
  throw new Error("Update feed target does not match the release platform/architecture.");
const feed = new URL(config.feedUrl);
if (feed.protocol !== "https:" || feed.username || feed.password || feed.search || feed.hash)
  throw new Error("Update releases require a credential-free HTTPS feed URL.");
if (process.platform === "darwin" && !/^[A-Z0-9]{10}$/.test(config.macTeamId ?? ""))
  throw new Error("A stable Apple Developer Team ID is required.");
if (process.platform === "win32" && (!Array.isArray(config.windowsPublisherNames) || !config.windowsPublisherNames.length || config.windowsPublisherNames.some(name => typeof name !== "string" || !name.trim())))
  throw new Error("Expected Authenticode publisher names are required.");

module.exports = {
  ...base,
  // Never silently produce an unsigned automatic-update release.
  forceCodeSigning: true,
  publish: { provider: "generic", url: feed.href },
  mac: { ...base.mac, hardenedRuntime: true, notarize: true },
  win: { ...base.win, publisherName: config.windowsPublisherNames },
};
