// Local preparation only. Never signs, runs an installer, enrolls a PC or publishes.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
const [
  flag,
  releaseName,
  baseVersion,
  targetVersion,
  resumeTemp,
  resumeStage,
  extra,
] = process.argv.slice(2);
assert.equal(flag, "--prepare-local-only");
assert.equal(extra, undefined);
assert.equal(Boolean(resumeTemp), Boolean(resumeStage));
const resuming = Boolean(resumeTemp);
assert.match(releaseName ?? "", /^piloto-win-[0-9]{8}(?:-[0-9]{1,2})?$/);
const compareVersions = (left, right) => {
  for (const v of [left, right])
    assert.match(
      v ?? "",
      /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/,
    );
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shell = join(root, "apps", "desktop-shell");
const corepack = join(
  dirname(process.execPath),
  "node_modules/corepack/dist/corepack.js",
);
const run = promisify(execFile);
const shellRequire = createRequire(join(shell, "package.json"));
const builderRequire = createRequire(
  shellRequire.resolve("electron-builder/package.json"),
);
const libRequire = createRequire(
  builderRequire.resolve("app-builder-lib/package.json"),
);
const asar = libRequire("@electron/asar");
const electronVersion = shellRequire("electron/package.json").version;
const sevenZip =
  "C:/Users/Emir/AppData/Local/electron-builder/Cache/7zip@1.0.0/7zip-win-x64-a34pt/bin/7za.exe";
const keyId = "gastronomia-piloto-ed25519-01";
const custody = join(process.env.LOCALAPPDATA, "DeltaNube-Firma-Piloto-01");
// ONLY public PEM and PASS receipt are read; signing is a separate interactive action.
const spkiPem = await readFile(join(custody, "pilot-01.public.pem"), "utf8");
assert.match(spkiPem, /^-----BEGIN PUBLIC KEY-----\r?\n/);
const key = createPublicKey(spkiPem);
assert.equal(key.asymmetricKeyType, "ed25519");
const spki = key.export({ type: "spki", format: "der" });
const sha256 = createHash("sha256").update(spki).digest("hex");
const recovery = JSON.parse(
  (await readFile(join(custody, "recibo-recuperacion.json"), "utf8")).replace(
    /^\uFEFF/,
    "",
  ),
);
assert.equal(recovery.status, "PASS");
assert.equal(recovery.keyId, keyId);
assert.equal(recovery.fingerprint, sha256);
const packagePath = join(shell, "package.json");
const configPath = join(shell, "updates-config.json");
const packageBytes = await readFile(packagePath);
const configBytes = await readFile(configPath);
const pkg = JSON.parse(packageBytes);
assert.deepEqual(JSON.parse(configBytes), { enabled: false });
assert.equal(pkg.build.appId, "com.deltanube.gastronomy");
assert.ok(compareVersions(baseVersion, pkg.version) > 0);
assert.ok(compareVersions(targetVersion, baseVersion) > 0);
const pilot = JSON.parse(
  await readFile(join(shell, "updates-config.pilot.example.json")),
);
assert.deepEqual(pilot, {
  enabled: false,
  mode: "windows-ed25519-pilot-v1",
  target: "win32-x64",
  feedUrl:
    "https://actualizaciones.deltanubeweb.com/gastronomia/piloto/windows/x64/",
});
assert.ok(existsSync(corepack) && existsSync(sevenZip));
assert.ok(existsSync(join(shell, "renderer/index.html")));
const output = join(shell, "release", releaseName);
assert.ok(
  !existsSync(output),
  "Cannot overwrite an existing pilot release folder",
);
const tempBase = await realpath(tmpdir());
const temp = resuming
  ? await realpath(resumeTemp)
  : await mkdtemp(join(tempBase, "dn-pilot-packaging-"));
assert.equal(dirname(temp), tempBase);
assert.match(basename(temp), /^dn-pilot-packaging-/);
const stageParent = join(shell, ".test-tmp");
await mkdir(stageParent, { recursive: true });
const stage = resuming
  ? await realpath(resumeStage)
  : await mkdtemp(join(stageParent, "pilot-pack-"));
assert.equal(dirname(stage), await realpath(stageParent));
assert.match(basename(stage), /^pilot-pack-/);
const markerFile = `windows-${releaseName}.enrollment`;
const markerValue = `delta-nube-local-enrollment:${releaseName}:${sha256}`;
const receipt = {
  schema: 1,
  state: "PACKAGING",
  output,
  buildWork: temp,
  baseVersion,
  targetVersion,
  keyId,
  publicKeySha256: sha256,
  recoveryVerifiedAt: recovery.timeUtc,
  pilotMode: pilot.mode,
  feedUrl: pilot.feedUrl,
  enrollment: { file: markerFile, created: false, required: true },
  installers: {},
};
const denied =
  /^(?:GASTRONOMY_|CSC_|WIN_CSC_|GH_TOKEN$|GITHUB_TOKEN$|GITHUB_RELEASE_TOKEN$|KEYGEN_TOKEN$|BITBUCKET_TOKEN$|NODE_OPTIONS$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$|ELECTRON_RUN_AS_NODE$|ELECTRON_BUILDER_|DEBUG$)/i;
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !denied.test(key)),
  ),
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};
async function command(name, args) {
  const logPath = join(temp, name + ".log");
  const log = createWriteStream(logPath);
  console.log("RUN", name);
  const child = spawn(process.execPath, [corepack, "pnpm", ...args], {
    cwd: shell,
    env,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const [code] = await once(child, "close");
  log.end();
  await once(log, "close");
  assert.equal(code, 0, `Build failed. See ${logPath}`);
}
async function patch(name, anchor, updated) {
  const path = join(stage, "src", name);
  const text = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  assert.equal(
    text.split(anchor).length,
    2,
    "Missing or ambiguous staging anchor",
  );
  await writeFile(
    path,
    text.replace(anchor, () => updated),
  );
}
async function sha(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const runtimeDeps = [
  "better-sqlite3-multiple-ciphers",
  "electron-updater",
  "js-yaml",
];
function findInstalledDependency(name, issuer) {
  const req = createRequire(join(issuer, "package.json"));
  // Query the package subpath so npm packages named like a Node builtin
  // (e.g. "buffer") still resolve to their installed package directory.
  for (const location of req.resolve.paths(`${name}/package.json`) ?? []) {
    const candidate = join(location, name, "package.json");
    if (existsSync(candidate)) return dirname(candidate);
  }
  return null;
}
const privateArtifact =
  /(?:^|[/\\])(?:\.env(?:\.|$)|licensing-secrets(?:[/\\]|$))|\.(?:pem|pfx|p12|key|dnbak|sqlite(?:3)?|db)(?:$|[-.])/i;
async function copyDependency(
  name,
  issuer,
  destination,
  ancestors = new Map(),
  optional = false,
) {
  assert.ok(
    !name.startsWith("@gastronomy/"),
    "A workspace dependency must never be copied directly",
  );
  assert.match(name, /^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i);
  const location = findInstalledDependency(name, issuer);
  if (!location && optional) return;
  assert.ok(location, `Missing installed runtime dependency: ${name}`);
  const source = await realpath(location);
  if (ancestors.get(name) === source) return;
  assert.ok(
    !ancestors.has(name),
    `Conflicting cyclic runtime dependency: ${name}`,
  );
  const to = join(destination, name);
  assert.ok(!existsSync(to));
  const metadata = JSON.parse(await readFile(join(source, "package.json")));
  await cp(source, to, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (file) => {
      const path = relative(source, file);
      return (
        !path.split(sep).includes("node_modules") && !privateArtifact.test(path)
      );
    },
  });
  const chain = new Map(ancestors).set(name, source);
  const children = {
    ...metadata.dependencies,
    ...metadata.optionalDependencies,
  };
  for (const dep of Object.keys(children)) {
    await copyDependency(
      dep,
      source,
      join(to, "node_modules"),
      chain,
      Object.hasOwn(metadata.optionalDependencies ?? {}, dep),
    );
  }
}
async function inspectArchive(args) {
  try {
    return await run(sevenZip, args, {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    // 7-Zip can return 1 because the archive is embedded in NSIS, not a plain .7z.
    if (
      error.code === 1 &&
      /There are data after the end of archive/i.test(error.stdout) &&
      !/\bERROR(?:S|:)?\b/i.test(error.stdout + error.stderr)
    )
      return error;
    throw error;
  }
}
console.log("BUILD_EVIDENCE", temp);
const tc = join(stage, "qa-tsup.cjs");
const bundle = join(stage, "dist");
const configDir = join(stage, "public-config");
const packagedConfig = { ...pilot, enabled: true };
const licenseConfig = join(shell, "licensing-config.json");
const runtimeApp = join(temp, "standalone-app");
try {
  if (!resuming) {
    await cp(join(shell, "src"), join(stage, "src"), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await patch(
      "windows-pilot-trust.ts",
      "const compiledPilotPins: readonly PilotPin[] = [];",
      `const compiledPilotPins: readonly PilotPin[] = ${JSON.stringify([{ keyId, spkiPem, sha256 }])};`,
    );
    const anchor =
      "      const adapter = dependencies.createWindowsSignedAdapter(";
    // The JSON opts into the pilot mode in this pair only. A separate local gate
    // keeps it inactive until approved enrollment in the actual profile.
    await patch(
      "update-runtime.ts",
      anchor,
      `      if (channel === "pilot") {
        const local = options.userDataPath
          ? await readFile(join(options.userDataPath, ${JSON.stringify(markerFile)}), "utf8").catch(() => null)
          : null;
        if (local?.trim() !== ${JSON.stringify(markerValue)}) throw new Error("Windows pilot is not enrolled");
      }
${anchor}`,
    );
    const entries = Object.fromEntries(
      ["main", "preload", "print-preview-preload"].map((f) => [
        f,
        join(stage, "src", f + ".ts").replaceAll("\\", "/"),
      ]),
    );
    await writeFile(
      tc,
      `module.exports={entry:${JSON.stringify(entries)},outDir:${JSON.stringify(bundle)},
    format:["cjs"],platform:"node",target:"node20",sourcemap:false,clean:false,
    noExternal:[/^@gastronomy\\//,/^qrcode(?:\\/.*)?$/],external:["electron","better-sqlite3-multiple-ciphers"]};`,
    );
    await mkdir(configDir);
    await writeFile(
      join(configDir, "updates-config.json"),
      JSON.stringify(packagedConfig),
    );
    await copyFile(licenseConfig, join(configDir, "licensing-config.json"));
  }
  const fakeProfile = await mkdtemp(join(temp, "gate-test-only-"));
  // Exercise the actual staged module with an injected adapter, never Electron or network.
  const gateTest = `import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import path from "node:path";
    import { createUpdateRuntime } from ${JSON.stringify(pathToFileURL(join(stage, "src/update-runtime.ts")).href)};
    const dir=${JSON.stringify(fakeProfile)};
    const options={isPackaged:true,platform:"win32",arch:"x64",currentVersion:${JSON.stringify(baseVersion)},configPath:"fixture",resourcesPath:dir,appPath:dir,userDataPath:dir};
    const conf=${JSON.stringify(packagedConfig)};
    let factoryCalls=0;
    const deps={
      readText:async()=>JSON.stringify(conf),
      createAdapter:async()=>assert.fail("Legacy fallback"),
      verifyMacSignature:async()=>assert.fail("Legacy verifier"),
      createWindowsSignedAdapter:(_opts,url,channel)=>{
        assert.equal(channel,"pilot");assert.equal(url,conf.feedUrl);factoryCalls++;
        return {on(){},async checkForUpdates(){assert.fail("network")},async downloadUpdate(){assert.fail("download")},quitAndInstall(){assert.fail("launch")}};
      }
    };
    assert.equal((await createUpdateRuntime(options,deps)).getStatus().state,"DISABLED");
    assert.equal(factoryCalls,0);
    await fs.writeFile(path.join(dir,${JSON.stringify(markerFile)}),"wrong",{flag:"wx"});
    assert.equal((await createUpdateRuntime(options,deps)).getStatus().state,"DISABLED");
    assert.equal(factoryCalls,0);
    await fs.writeFile(path.join(dir,${JSON.stringify(markerFile)}),${JSON.stringify(markerValue)});
    assert.equal((await createUpdateRuntime(options,deps)).getStatus().state,"IDLE");
    assert.equal(factoryCalls,1);
    await fs.unlink(path.join(dir,${JSON.stringify(markerFile)}));`;
  await run(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module",
      "-e",
      gateTest,
    ],
    { cwd: shell, env, windowsHide: true, timeout: 15_000 },
  );
  receipt.gateCheck =
    "PASS: no marker/wrong marker disabled; matching marker only in disposable fixture permits initialization";
  if (!resuming) {
    await command("bundle", ["exec", "tsup", "--config", tc]);
    // A standalone app project avoids electron-builder's workspace dependency
    // collector, which can bring along unrelated data from linked packages.
    await mkdir(runtimeApp);
    const deps = Object.fromEntries(
      runtimeDeps.map((name) => [name, pkg.dependencies[name]]),
    );
    await writeFile(
      join(runtimeApp, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          private: true,
          main: pkg.main,
          packageManager: "npm@11.9.0",
          dependencies: deps,
        },
        null,
        2,
      ),
    );
    await cp(bundle, join(runtimeApp, "dist"), { recursive: true });
    await cp(join(shell, "renderer"), join(runtimeApp, "renderer"), {
      recursive: true,
    });
    await cp(
      join(shell, "build", "icons"),
      join(runtimeApp, "build", "icons"),
      { recursive: true },
    );
    await copyFile(
      join(configDir, "updates-config.json"),
      join(runtimeApp, "updates-config.json"),
    );
    await copyFile(
      join(configDir, "licensing-config.json"),
      join(runtimeApp, "licensing-config.json"),
    );
    for (const dep of runtimeDeps)
      await copyDependency(dep, shell, join(runtimeApp, "node_modules"));
  }
  const main = await readFile(join(bundle, "main.js"), "utf8");
  assert.ok(
    main.includes(sha256) &&
      main.includes(keyId) &&
      main.includes(spki.toString("base64")) &&
      main.includes(markerValue),
  );
  assert.ok(
    !main.includes("BEGIN PRIVATE KEY") &&
      !main.includes("BEGIN ENCRYPTED PRIVATE KEY"),
  );
  assert.equal(
    await readFile(join(runtimeApp, "dist", "main.js"), "utf8"),
    main,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(runtimeApp, "updates-config.json"))),
    packagedConfig,
  );
  assert.ok(
    existsSync(
      join(
        runtimeApp,
        "node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node",
      ),
    ),
  );
  receipt.packaging =
    "standalone app; no workspace folders collected; runtime dependency tree copied from pinned installed modules";
  for (const version of [baseVersion, targetVersion]) {
    const work = join(temp, version);
    const artifactName = `Delta-Nube-Gastronomia-Piloto-${version}-x64.exe`;
    const config = join(stage, `builder-${version}.json`);
    const installer = join(work, artifactName);
    if (!resuming || !existsSync(installer)) {
      await writeFile(
        config,
        JSON.stringify(
          {
            ...pkg.build,
            publish: null,
            forceCodeSigning: false,
            npmRebuild: false,
            electronVersion,
            directories: { output: work },
            extraMetadata: { version },
            files: [
              "package.json",
              "node_modules/**/*",
              "dist/**/*",
              "renderer/**/*",
              "updates-config.json",
              "licensing-config.json",
              "!**/*.{sqlite,sqlite-shm,sqlite-wal,dnbak,pem,pfx,p12,key}",
              "!**/.env{,.*}",
              "!**/licensing-secrets{,/**/*}",
            ],
            nsis: { ...pkg.build.nsis, artifactName },
            win: { ...pkg.build.win, signExecutable: false },
          },
          null,
          2,
        ),
      );
      await command(`nsis-${version}`, [
        "exec",
        "electron-builder",
        "--projectDir",
        runtimeApp,
        "--config",
        config,
        "--win",
        "nsis",
        "--x64",
        "--publish",
        "never",
      ]);
    }
    const unpacked = join(work, "win-unpacked", "resources");
    assert.ok(!existsSync(join(unpacked, "app-update.yml")));
    const extract = await mkdtemp(join(work, "inspection-"));
    // 7-Zip treats the embedded 7z archive as data; the NSIS program is never run.
    const listed = await inspectArchive(["l", "-slt", "--", installer]);
    assert.ok(
      !/Path = .*[/\\](?:app-update\.yml|latest\.yml|[^\r\n]*(?:\.pem|\.pfx|\.dnbak))$/im.test(
        listed.stdout,
      ),
    );
    await inspectArchive([
      "x",
      "-y",
      `-o${extract}`,
      "--",
      installer,
      "resources/app.asar",
      "resources/app.asar.unpacked/*",
    ]);
    const archivedAsar = join(extract, "resources", "app.asar");
    const payloadHash = await sha(archivedAsar);
    assert.equal(payloadHash, await sha(join(unpacked, "app.asar")));
    assert.deepEqual(
      JSON.parse(asar.extractFile(archivedAsar, "updates-config.json")),
      packagedConfig,
    );
    const meta = JSON.parse(asar.extractFile(archivedAsar, "package.json"));
    assert.equal(meta.version, version);
    assert.equal(meta.name, pkg.name);
    assert.equal(meta.main, pkg.main);
    assert.deepEqual(
      asar.extractFile(archivedAsar, "licensing-config.json"),
      await readFile(licenseConfig),
    );
    assert.equal(
      asar.extractFile(archivedAsar, "dist/main.js").toString(),
      main,
    );
    const files = asar.listPackage(archivedAsar);
    assert.ok(
      !files.some(
        (name) =>
          privateArtifact.test(name) ||
          /[/\\]node_modules[/\\]@gastronomy[/\\]/i.test(name),
      ),
    );
    for (const dep of runtimeDeps) {
      const fromArchive = JSON.parse(
        asar.extractFile(
          archivedAsar,
          join("node_modules", dep, "package.json"),
        ),
      );
      assert.equal(fromArchive.name, dep);
      assert.equal(fromArchive.version, pkg.dependencies[dep]);
    }
    const native = join(
      "node_modules",
      "better-sqlite3-multiple-ciphers",
      "build",
      "Release",
      "better_sqlite3.node",
    );
    assert.equal(
      await sha(join(extract, "resources", "app.asar.unpacked", native)),
      await sha(join(runtimeApp, native)),
    );
    receipt.installers[version] = {
      artifactName,
      installer,
      size: (await stat(installer)).size,
      sha256: await sha(installer),
      asarSha256: payloadHash,
      embeddedVersion: meta.version,
    };
  }
  assert.deepEqual(await readFile(packagePath), packageBytes);
  assert.deepEqual(await readFile(configPath), configBytes);
  await mkdir(output);
  const folders = [
    join(output, "instalacion-inicial"),
    join(output, "feed-local", "versions", targetVersion),
  ];
  for (const [i, version] of [baseVersion, targetVersion].entries()) {
    const entry = receipt.installers[version];
    const dir = folders[i];
    assert.ok(dir);
    await mkdir(dir, { recursive: true });
    const archive = join(dir, entry.artifactName);
    await copyFile(entry.installer, archive, 1); // COPYFILE_EXCL
    assert.equal(await sha(archive), entry.sha256);
    entry.path = archive;
  }
  await writeFile(join(output, "clave-publica-piloto.pem"), spkiPem, {
    flag: "wx",
  });
  receipt.state = "READY_FOR_LOCAL_SIGNING";
  await writeFile(
    join(output, "preflight-instaladores.json"),
    JSON.stringify(receipt, null, 2),
    { flag: "wx" },
  );
  console.log("READY_FOR_LOCAL_SIGNING", output);
} catch (error) {
  console.error("Review build evidence in", temp);
  throw error;
}
