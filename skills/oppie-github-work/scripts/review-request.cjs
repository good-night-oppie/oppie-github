"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node/core.cjs
var require_core = __commonJS({
  "node/core.cjs"(exports2, module2) {
    "use strict";
    var crypto = require("node:crypto");
    var OWNER = "good-night-oppie";
    var REPOSITORIES = Object.freeze({ MontClip: 1441621868, "MontClip-Cindy": 1446532339 });
    var PG_REPOSITORIES = Object.freeze({ ...REPOSITORIES, "oppie-github": 1451885379, "sglang-review-inbox": 1451900929 });
    var PG_INSTALLATION_REPOSITORIES = Object.freeze({ ...PG_REPOSITORIES, "montclip-rsi": 1450602468, "rsi-playbooks": 1450603260 });
    var executionRepositories = (account) => account.account === "pg" ? PG_REPOSITORIES : REPOSITORIES;
    var APP_NAMES = Object.freeze({ bb: "BBOppieXYZ", cindy: "CindyOppieXYZ", deja: "DejaOppieXYZ", dd: "DDOppieXYZ", gg: "GGOppieXYZ", jj: "JJOppieXYZ", pg: "PGOppieXYZ", qq: "QQOppieXYZ", rea: "ReaOppieXYZ", video: "VideoOppieXYZ", vv: "VVOppieXYZ", reviewinbox: "ReviewInboxOppieXYZ" });
    var ACCOUNTS = Object.freeze(Object.fromEntries([
      ["bb", 5665927, 179806310],
      ["cindy", 5665939, 179806330],
      ["deja", 5665940, 179806356],
      ["dd", 5665941, 179806387],
      ["gg", 5665942, 179806414],
      ["jj", 5665943, 179806445],
      ["pg", 5665944, 179806482],
      ["qq", 5665946, 179806512],
      ["rea", 5665948, 179806534],
      ["video", 5665949, 179806582],
      ["vv", 5665951, 179806217],
      ["reviewinbox", 5687106, 180305629]
    ].map(([account, app_id, installation_id]) => [account, Object.freeze({
      account,
      app_id,
      installation_id,
      app_name: APP_NAMES[account],
      app_slug: APP_NAMES[account].toLowerCase(),
      app_slug_status: "expected_not_live",
      allowed_slugs: Object.freeze(account === "reviewinbox" ? ["reviewinboxoppiexyz"] : ["oppie-agent-" + account, APP_NAMES[account].toLowerCase()]),
      admin: account === "qq" || account === "pg"
    })])));
    function allowedAppSlug(account, slug) {
      return typeof slug === "string" && Object.hasOwn(ACCOUNTS, account) && ACCOUNTS[account].allowed_slugs.includes(slug);
    }
    function knownBotLogin(account, login) {
      return typeof login === "string" && Object.hasOwn(ACCOUNTS, account) && ACCOUNTS[account].allowed_slugs.some((slug) => login === slug + "[bot]");
    }
    var OPERATION_NAMES = Object.freeze(["identity", "get_contents", "list_branches", "list_issues", "get_issue", "create_issue", "update_issue", "comment_issue", "list_pulls", "get_pull", "pull_files", "create_pull", "update_pull", "list_reviews", "submit_review", "create_branch", "update_file", "admin_get", "admin_update"]);
    var CoreError = class extends Error {
      constructor(code, execution = "not_executed", status) {
        super(code);
        this.code = code;
        this.execution = execution;
        if (status) this.status = status;
      }
    };
    function bad(code = "INVALID_ARGUMENTS") {
      throw new CoreError(code);
    }
    function obj(x) {
      return !!x && typeof x === "object" && !Array.isArray(x);
    }
    function exact(x, keys) {
      if (!obj(x) || Object.keys(x).some((k) => !keys.includes(k))) bad();
    }
    function str(x, max = 1e4) {
      if (typeof x !== "string" || x.length > max || x.includes("\0")) bad();
      return x;
    }
    function nonempty(x, max = 200) {
      if (!str(x, max).trim()) bad();
      return x;
    }
    function positive(x) {
      if (!Number.isSafeInteger(x) || x < 1) bad();
      return x;
    }
    function sha(x) {
      if (typeof x !== "string" || !/^[a-f0-9]{40}$/i.test(x)) bad();
      return x;
    }
    function ref(x) {
      nonempty(x, 200);
      if (/[\s~^:?*\[\\%\x00-\x1f]/.test(x) || x.includes("..") || x.includes("@{") || x.includes("//") || x.startsWith("/") || x.endsWith("/") || x.endsWith(".") || x.split("/").some((s) => s.startsWith(".") || s.endsWith(".lock"))) bad("INVALID_REF");
      return x;
    }
    function filePath(x, empty = false) {
      str(x, 1e3);
      if (!x && empty) return "";
      if (!x || x.startsWith("/") || /[\\%?#\x00-\x1f]/.test(x) || x.split("/").some((s) => !s || s === "." || s === "..")) bad("INVALID_PATH");
      return x.split("/").map(encodeURIComponent).join("/");
    }
    function repoName(x, allowed) {
      if (typeof x !== "string") bad("REPOSITORY_REQUIRED");
      const n = x.startsWith(OWNER + "/") ? x.slice(OWNER.length + 1) : x;
      if (!Object.hasOwn(allowed, n)) bad("REPOSITORY_NOT_ALLOWED");
      return n;
    }
    function permissions(a) {
      return { contents: a.account === "reviewinbox" ? "read" : "write", issues: "write", pull_requests: "write", metadata: "read", ...a.admin ? { administration: "write" } : {} };
    }
    function checkPermissions(actual, a) {
      const expected = permissions(a);
      if (!obj(actual) || Object.entries(expected).some(([k, v]) => actual[k] !== v) || Object.entries(actual).some(([k, v]) => v !== "none" && !Object.hasOwn(expected, k))) bad("PERMISSION_MISMATCH");
    }
    function makeJwt(account, pem, now = Date.now()) {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const t = Math.floor(now / 1e3);
      const p = Buffer.from(JSON.stringify({ iat: t - 60, exp: t + 480, iss: String(account.app_id) })).toString("base64url");
      try {
        const key = crypto.createPrivateKey(pem);
        if (key.asymmetricKeyType !== "rsa") bad("INVALID_PRIVATE_KEY");
        return h + "." + p + "." + crypto.sign("RSA-SHA256", Buffer.from(h + "." + p), key).toString("base64url");
      } catch (_) {
        bad("INVALID_PRIVATE_KEY");
      }
    }
    function listQuery(a, extra = []) {
      exact(a, ["page", "per_page", ...extra]);
      const q = new URLSearchParams({ page: String(a.page === void 0 ? 1 : positive(a.page)), per_page: String(a.per_page === void 0 ? 30 : positive(a.per_page)) });
      if (Number(q.get("per_page")) > 100) bad();
      return q;
    }
    function labels(value) {
      if (!Array.isArray(value) || value.length > 30) bad();
      return value.map((x) => nonempty(x, 100));
    }
    function clean(value, secrets) {
      if (typeof value === "string") {
        for (const secret of secrets) if (secret) value = value.split(secret).join("[REDACTED]");
        return value;
      }
      if (Array.isArray(value)) return value.map((x) => clean(x, secrets));
      if (obj(value)) return Object.fromEntries(Object.entries(value).filter(([k]) => !["token", "access_token", "private_key", "authorization"].includes(k.toLowerCase())).map(([k, v]) => [k, clean(v, secrets)]));
      return value;
    }
    function createClient2({ credentials, fetch: fetcher = globalThis.fetch, now = Date.now } = {}) {
      if (typeof credentials !== "function" || typeof fetcher !== "function") throw Error("DEPENDENCY_REQUIRED");
      async function run(input2) {
        let secrets = [];
        try {
          let exactRepos = function(r, expected) {
            const count = Object.keys(expected).length;
            return r?.total_count === count && Array.isArray(r.repositories) && r.repositories.length === count && r.repositories.every((x) => x.full_name === OWNER + "/" + x.name && expected[x.name] === x.id) && new Set(r.repositories.map((x) => x.id)).size === count;
          };
          exact(input2, ["account", "repo", "operation", "args"]);
          if (typeof input2.account !== "string" || !Object.hasOwn(ACCOUNTS, input2.account)) bad("ACCOUNT_REQUIRED");
          const account = ACCOUNTS[input2.account];
          const operation = input2.operation;
          if (!OPERATION_NAMES.includes(operation)) bad("UNKNOWN_OPERATION");
          const allowedRepos = executionRepositories(account);
          const installedRepos = account.account === "pg" ? PG_INSTALLATION_REPOSITORIES : allowedRepos;
          const repo = repoName(input2.repo, allowedRepos);
          const args = input2.args === void 0 ? {} : input2.args;
          if (!obj(args)) bad();
          if (account.account === "reviewinbox") {
            if (["create_branch", "update_file"].includes(operation)) bad("READ_ONLY_CONTENTS");
            if (["admin_get", "admin_update"].includes(operation)) bad("ADMIN_ACCOUNT_REQUIRED");
            if (operation === "submit_review" && args.event !== "COMMENT") bad("COMMENT_ONLY_REVIEWER");
          }
          const root = "/repos/" + OWNER + "/" + repo;
          let method = "GET", route, body, preflight;
          const number = () => positive(args.number);
          const issuePayload = (creating) => {
            exact(args, creating ? ["title", "body", "labels"] : ["number", "title", "body", "labels", "state"]);
            const v = {};
            if (creating || args.title !== void 0) v.title = nonempty(args.title, 256);
            if (args.body !== void 0) v.body = str(args.body, 65e3);
            if (args.labels !== void 0) v.labels = labels(args.labels);
            if (args.state !== void 0) {
              if (!["open", "closed"].includes(args.state)) bad();
              v.state = args.state;
            }
            if (!Object.keys(v).length) bad();
            return v;
          };
          switch (operation) {
            case "identity":
              exact(args, []);
              break;
            case "get_contents":
              exact(args, ["path", "ref"]);
              route = root + "/contents/" + filePath(args.path ?? "", true) + (args.ref ? "?ref=" + encodeURIComponent(ref(args.ref)) : "");
              break;
            case "list_branches":
              route = root + "/branches?" + listQuery(args);
              break;
            case "list_issues":
            case "list_pulls": {
              const q = listQuery(args, ["state"]);
              if (args.state !== void 0) {
                if (!["open", "closed", "all"].includes(args.state)) bad();
                q.set("state", args.state);
              }
              route = root + (operation === "list_issues" ? "/issues?" : "/pulls?") + q;
              break;
            }
            case "get_issue":
              exact(args, ["number"]);
              route = root + "/issues/" + number();
              break;
            case "create_issue":
              body = issuePayload(true);
              method = "POST";
              route = root + "/issues";
              break;
            case "update_issue":
              body = issuePayload(false);
              method = "PATCH";
              route = root + "/issues/" + number();
              break;
            case "comment_issue":
              exact(args, ["number", "body"]);
              body = { body: nonempty(args.body, 65e3) };
              method = "POST";
              route = root + "/issues/" + number() + "/comments";
              break;
            case "get_pull":
              exact(args, ["number"]);
              route = root + "/pulls/" + number();
              break;
            case "pull_files":
            case "list_reviews": {
              const q = listQuery(args, ["number"]);
              route = root + "/pulls/" + number() + (operation === "pull_files" ? "/files?" : "/reviews?") + q;
              break;
            }
            case "create_pull":
              exact(args, ["title", "body", "head", "base", "draft"]);
              body = { title: nonempty(args.title, 256), body: str(args.body ?? "", 65e3), head: ref(args.head), base: ref(args.base), draft: args.draft === void 0 ? true : args.draft };
              if (typeof body.draft !== "boolean" || body.head === body.base) bad();
              method = "POST";
              route = root + "/pulls";
              break;
            case "update_pull":
              exact(args, ["number", "title", "body", "state"]);
              body = {};
              if (args.title !== void 0) body.title = nonempty(args.title, 256);
              if (args.body !== void 0) body.body = str(args.body, 65e3);
              if (args.state !== void 0) {
                if (!["open", "closed"].includes(args.state)) bad();
                body.state = args.state;
              }
              if (!Object.keys(body).length) bad();
              method = "PATCH";
              route = root + "/pulls/" + number();
              break;
            case "submit_review": {
              exact(args, ["number", "commit_id", "event", "body", "comments"]);
              if (!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(args.event)) bad();
              body = { commit_id: sha(args.commit_id), event: args.event, body: str(args.body ?? "", 65e3) };
              if (args.comments !== void 0) {
                if (!Array.isArray(args.comments) || args.comments.length > 30) bad();
                body.comments = args.comments.map((c) => {
                  exact(c, ["path", "line", "side", "body", "start_line", "start_side"]);
                  filePath(c.path);
                  if (!["LEFT", "RIGHT"].includes(c.side)) bad();
                  const v = { path: c.path, line: positive(c.line), side: c.side, body: nonempty(c.body, 1e4) };
                  if (c.start_line !== void 0) {
                    v.start_line = positive(c.start_line);
                    if (!["LEFT", "RIGHT"].includes(c.start_side) || v.start_line > v.line) bad();
                    v.start_side = c.start_side;
                  }
                  return v;
                });
              }
              if (args.event !== "APPROVE" && !body.body.trim() && !body.comments?.length) bad();
              method = "POST";
              route = root + "/pulls/" + number() + "/reviews";
              preflight = { kind: "review", number: number(), sha: body.commit_id };
              break;
            }
            case "create_branch":
              exact(args, ["branch", "sha"]);
              body = { ref: "refs/heads/" + ref(args.branch), sha: sha(args.sha) };
              method = "POST";
              route = root + "/git/refs";
              preflight = { kind: "branch", branch: args.branch };
              break;
            case "update_file":
              exact(args, ["path", "branch", "expected_sha", "message", "content_base64"]);
              filePath(args.path);
              ref(args.branch);
              if (!Object.hasOwn(args, "expected_sha") || args.expected_sha !== null && !/^[a-f0-9]{40}$/i.test(args.expected_sha)) bad();
              if (typeof args.content_base64 !== "string" || args.content_base64.length > 7e5 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(args.content_base64)) bad();
              body = { message: nonempty(args.message, 500), content: args.content_base64, branch: args.branch, ...args.expected_sha ? { sha: args.expected_sha } : {} };
              method = "PUT";
              route = root + "/contents/" + filePath(args.path);
              preflight = { kind: "file", branch: args.branch, sha: args.expected_sha, path: args.path };
              break;
            case "admin_get":
              exact(args, []);
              if (!account.admin) bad("ADMIN_ACCOUNT_REQUIRED");
              route = root;
              break;
            case "admin_update":
              exact(args, ["allow_squash_merge", "allow_merge_commit", "allow_rebase_merge", "delete_branch_on_merge"]);
              if (!account.admin) bad("ADMIN_ACCOUNT_REQUIRED");
              if (!Object.keys(args).length || Object.values(args).some((x) => typeof x !== "boolean")) bad();
              method = "PATCH";
              route = root;
              body = { ...args };
              break;
          }
          async function api(path, token2, method2 = "GET", payload) {
            if (!path.startsWith("/") || path.startsWith("//") || /[\r\n\\]/.test(path)) bad("INVALID_API_ROUTE");
            let response;
            try {
              response = await fetcher("https://api.github.com" + path, { method: method2, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "oppie-github-agent-plugin", Authorization: "Bearer " + token2, ...payload ? { "Content-Type": "application/json" } : {} }, redirect: "error", signal: AbortSignal.timeout(3e4), ...payload ? { body: JSON.stringify(payload) } : {} });
            } catch (_) {
              throw new CoreError(method2 === "GET" ? "NETWORK_ERROR" : "WRITE_OUTCOME_UNKNOWN", method2 === "GET" ? "not_executed" : "unknown");
            }
            if (response.status >= 300 && response.status < 400) throw new CoreError("REDIRECT_REFUSED", method2 === "GET" ? "not_executed" : "unknown", response.status);
            if (!response.ok) throw new CoreError("GITHUB_HTTP_" + response.status, method2 !== "GET" && response.status >= 500 ? "unknown" : "not_executed", response.status);
            let data;
            try {
              const text = await response.text();
              if (Buffer.byteLength(text) > 25e5) throw Error();
              data = text ? JSON.parse(text) : null;
            } catch (_) {
              throw new CoreError("INVALID_API_RESPONSE", method2 === "GET" ? "not_executed" : "unknown");
            }
            return data;
          }
          let pem;
          try {
            pem = await credentials(account.account);
          } catch (_) {
            bad("CREDENTIAL_UNAVAILABLE");
          }
          if (typeof pem !== "string") bad("CREDENTIAL_UNAVAILABLE");
          secrets.push(pem);
          const jwt = makeJwt(account, pem, now());
          secrets.push(jwt);
          pem = null;
          const app = await api("/app", jwt);
          if (Number(app?.id) !== account.app_id || !allowedAppSlug(account.account, app?.slug) || app?.owner?.login !== OWNER) bad("APP_IDENTITY_MISMATCH");
          const installation = await api("/app/installations/" + account.installation_id, jwt);
          if (Number(installation?.id) !== account.installation_id || Number(installation?.app_id) !== account.app_id || installation?.account?.login !== OWNER || installation?.account?.type !== "Organization" || installation?.repository_selection !== "selected" || installation?.suspended_at) bad("INSTALLATION_MISMATCH");
          checkPermissions(installation.permissions, account);
          const probeResponse = await api("/app/installations/" + account.installation_id + "/access_tokens", jwt, "POST", { permissions: { metadata: "read" } });
          if (typeof probeResponse?.token !== "string" || !probeResponse.token) bad("INVALID_INSTALLATION_TOKEN");
          secrets.push(probeResponse.token);
          const probe = await api("/installation/repositories?per_page=100", probeResponse.token);
          if (!exactRepos(probe, installedRepos)) bad("REPOSITORY_SCOPE_MISMATCH");
          const tokenResponse = await api("/app/installations/" + account.installation_id + "/access_tokens", jwt, "POST", { repository_ids: Object.values(allowedRepos), permissions: permissions(account) });
          if (typeof tokenResponse?.token !== "string" || !tokenResponse.token || Date.parse(tokenResponse.expires_at) <= now() + 3e4 || !Number.isFinite(Date.parse(tokenResponse.expires_at))) bad("INVALID_INSTALLATION_TOKEN");
          const token = tokenResponse.token;
          secrets.push(token);
          checkPermissions(tokenResponse.permissions, account);
          const repos = await api("/installation/repositories?per_page=100", token);
          if (!exactRepos(repos, allowedRepos)) bad("REPOSITORY_SCOPE_MISMATCH");
          if (preflight?.kind === "review") {
            const pr = await api(root + "/pulls/" + preflight.number, token);
            if (pr?.head?.sha !== preflight.sha) bad("STALE_HEAD");
            if (pr?.state !== "open" || pr?.draft) bad("PR_NOT_REVIEWABLE");
          }
          if (preflight?.kind === "branch" || preflight?.kind === "file") {
            const metadata = await api(root, token);
            if (metadata?.default_branch === preflight.branch) bad("DEFAULT_BRANCH_WRITE_REFUSED");
            if (preflight.kind === "file") {
              let current;
              try {
                current = await api(root + "/contents/" + filePath(preflight.path) + "?ref=" + encodeURIComponent(preflight.branch), token);
              } catch (e) {
                if (e.status !== 404 || preflight.sha !== null) throw e;
              }
              if ((current?.sha ?? null) !== preflight.sha) bad("STALE_FILE");
            }
          }
          const result = operation === "identity" ? { app_id: account.app_id, app_slug: app.slug, owner: OWNER, permissions: permissions(account), repositories: repos.repositories.map((r) => ({ id: r.id, full_name: r.full_name })), ...account.account === "pg" ? { installationRepositories: probe.repositories.map((r) => ({ id: r.id, full_name: r.full_name })) } : {}, expires_at: tokenResponse.expires_at } : await api(route, token, method, body);
          return { ok: true, receipt: { account: account.account, app_slug: app.slug, installation_id: account.installation_id, repo: OWNER + "/" + repo, operation, execution: "completed", url: typeof result?.html_url === "string" ? result.html_url : app.html_url }, result: clean(result, secrets) };
        } catch (e) {
          return { ok: false, errorCode: e instanceof CoreError ? e.code : "INTERNAL_ERROR", execution: e instanceof CoreError ? e.execution : "not_executed", ...e instanceof CoreError && e.status ? { status: e.status } : {} };
        } finally {
          secrets.fill("");
        }
      }
      return { run };
    }
    module2.exports = { createClient: createClient2, makeJwt, ACCOUNTS, APP_NAMES, allowedAppSlug, knownBotLogin, REPOSITORIES, OPERATION_NAMES, CoreError };
  }
});

// node/linux-security.cjs
var require_linux_security = __commonJS({
  "node/linux-security.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs/promises");
    var constants = require("node:fs").constants;
    var path = require("node:path");
    var crypto = require("node:crypto");
    var { spawn } = require("node:child_process");
    var MAGIC = Buffer.from("OPG1");
    var backendName = "Linux Secret Service + AES-256-GCM";
    function error(code) {
      const e = new Error(code);
      e.code = code;
      return e;
    }
    function createLinuxSecurity(options = {}) {
      const platform = options.platform || process.platform;
      const io = options.fs || fs;
      const uid = options.uid || (() => process.getuid());
      const namespace = options.namespace || "oppie-github-v1";
      if (!/^(oppie-github-v1|oppie-github-test-[a-f0-9]{8,64})$/.test(namespace)) throw error("INVALID_KEYRING_NAMESPACE");
      function linux() {
        if (platform !== "linux") throw error("LINUX_REQUIRED");
      }
      async function master(create) {
        linux();
        if (options.getMasterKey) {
          try {
            const key = Buffer.from(await options.getMasterKey(create));
            if (key.length !== 32) {
              key.fill(0);
              throw Error();
            }
            return key;
          } catch (_) {
            throw error("SECURE_STORAGE_UNAVAILABLE");
          }
        }
        return new Promise((resolve, reject) => {
          const child = (options.spawn || spawn)("python3", [path.join(__dirname, "secret-service.py")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
          let text = "", size = 0, done = false;
          const finish = (failure, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            text = "";
            failure ? reject(error(failure)) : resolve(value);
          };
          const timer = setTimeout(() => {
            child.kill();
            finish("SECURE_STORAGE_UNAVAILABLE");
          }, 12e3);
          child.on("error", () => finish("SECURE_STORAGE_UNAVAILABLE"));
          child.stdout.on("data", (part) => {
            size += part.length;
            if (size > 4096) {
              child.kill();
              finish("SECURE_STORAGE_UNAVAILABLE");
            } else text += part.toString("utf8");
          });
          child.stderr.on("data", () => {
          });
          child.stdin.on("error", () => finish("SECURE_STORAGE_UNAVAILABLE"));
          child.on("close", (code) => {
            if (done) return;
            try {
              const data = JSON.parse(text);
              if (code !== 0 || data.ok !== true) throw error(["KEYRING_LOCKED", "KEYRING_MISSING", "KEYRING_KEY_MISSING", "KEYRING_BUSY", "KEYRING_AMBIGUOUS", "KEYRING_PROMPT_REQUIRED"].includes(data.errorCode) ? data.errorCode : "SECURE_STORAGE_UNAVAILABLE");
              if (typeof data.key !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(data.key)) throw error("SECURE_STORAGE_UNAVAILABLE");
              const key = Buffer.from(data.key, "base64");
              data.key = "";
              if (key.length !== 32) {
                key.fill(0);
                throw error("SECURE_STORAGE_UNAVAILABLE");
              }
              finish(null, key);
            } catch (e) {
              finish(e.code || "SECURE_STORAGE_UNAVAILABLE");
            }
          });
          child.stdin.end(JSON.stringify({ operation: create ? "get-or-create" : "get", namespace }));
        });
      }
      function contextBytes(context) {
        if (typeof context !== "string" || !context || context.length > 1024 || context.includes("\0")) throw error("INVALID_KEY_CONTEXT");
        return Buffer.from(context, "utf8");
      }
      async function protect(data, context) {
        linux();
        const aad = contextBytes(context);
        const plain = Buffer.from(data);
        if (!plain.length || plain.length > 32768) {
          plain.fill(0);
          throw error("INVALID_KEY_DATA");
        }
        let key;
        try {
          key = await master(true);
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
          cipher.setAAD(aad);
          const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
          return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
        } finally {
          key?.fill(0);
          plain.fill(0);
        }
      }
      async function unprotect(data, context) {
        linux();
        const aad = contextBytes(context);
        const sealed = Buffer.from(data);
        if (sealed.length < 33 || sealed.length > 32800 || !sealed.subarray(0, 4).equals(MAGIC)) throw error("INVALID_CIPHERTEXT");
        let key;
        try {
          key = await master(false);
          const decipher = crypto.createDecipheriv("aes-256-gcm", key, sealed.subarray(4, 16));
          decipher.setAAD(aad);
          decipher.setAuthTag(sealed.subarray(16, 32));
          return Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()]);
        } catch (e) {
          if (e.code && /^(KEYRING_|SECURE_STORAGE_)/.test(e.code)) throw e;
          throw error("DECRYPT_FAILED");
        } finally {
          key?.fill(0);
        }
      }
      async function identity(target) {
        linux();
        if (typeof target !== "string" || !path.isAbsolute(target)) throw error("UNSAFE_STORE_ACL");
        const st = await io.lstat(target);
        const directory = st.isDirectory();
        if (st.isSymbolicLink() || !directory && !st.isFile() || st.uid !== uid() || !directory && st.nlink !== 1) throw error("UNSAFE_STORE_ACL");
        if (await io.realpath(target) !== path.resolve(target)) throw error("UNSAFE_STORE_ACL");
        return { st, directory };
      }
      async function verifyAcl(target) {
        try {
          const { st, directory } = await identity(target);
          if ((st.mode & 4095) !== (directory ? 448 : 384)) throw error("UNSAFE_STORE_ACL");
        } catch (e) {
          if (e.code === "LINUX_REQUIRED") throw e;
          throw error("UNSAFE_STORE_ACL");
        }
      }
      async function tightenNew(target, directory) {
        let handle;
        try {
          const before = await identity(target);
          if (before.directory !== !!directory) throw error("UNSAFE_STORE_ACL");
          handle = await io.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
          const st = await handle.stat();
          if (st.ino !== before.st.ino || st.dev !== before.st.dev || st.uid !== uid()) throw error("UNSAFE_STORE_ACL");
          await handle.chmod(directory ? 448 : 384);
          await handle.close();
          handle = null;
          await verifyAcl(target);
        } catch (e) {
          if (e.code === "LINUX_REQUIRED") throw e;
          throw error("UNSAFE_STORE_ACL");
        } finally {
          await handle?.close().catch(() => {
          });
        }
      }
      return { protect, unprotect, verifyAcl, tightenNew, backendName };
    }
    module2.exports = { ...createLinuxSecurity(), createLinuxSecurity, backendName };
  }
});

// node/store.cjs
var require_store = __commonJS({
  "node/store.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs/promises");
    var path = require("node:path");
    var os = require("node:os");
    var crypto = require("node:crypto");
    var { spawn, execFile } = require("node:child_process");
    var { promisify } = require("node:util");
    var runFile = promisify(execFile);
    var { ACCOUNTS, allowedAppSlug } = require_core();
    var APP_IDS = { bb: "5665927", cindy: "5665939", deja: "5665940", dd: "5665941", gg: "5665942", jj: "5665943", pg: "5665944", qq: "5665946", rea: "5665948", video: "5665949", vv: "5665951", reviewinbox: "5687106" };
    var INSTALL_IDS = { bb: "179806310", cindy: "179806330", deja: "179806356", dd: "179806387", gg: "179806414", jj: "179806445", pg: "179806482", qq: "179806512", rea: "179806534", video: "179806582", vv: "179806217", reviewinbox: "180305629" };
    var MAX_PEM = 32768;
    var MAX_STORE = 1048576;
    function failure(code) {
      const e = new Error(code);
      e.code = code;
      return e;
    }
    function metadata(account) {
      if (typeof account !== "string" || !Object.hasOwn(APP_IDS, account)) throw failure("UNKNOWN_ACCOUNT");
      return {
        account,
        appId: APP_IDS[account],
        installationId: INSTALL_IDS[account],
        appSlug: ACCOUNTS[account].app_slug,
        owner: "good-night-oppie",
        repositoryIds: [1441621868, 1446532339],
        admin: account === "qq"
      };
    }
    function entropy(account) {
      const m = metadata(account);
      return "oppie-github/v1/" + m.account + "/" + m.appId + "/" + m.installationId;
    }
    function powershell(script, input2) {
      return new Promise((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        let output = "", bytes = 0, settled = false;
        const finish = (err, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          err ? reject(failure("SECURE_STORAGE_UNAVAILABLE")) : resolve(value);
        };
        const timer = setTimeout(() => {
          child.kill();
          finish(true);
        }, 15e3);
        child.stdout.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_STORE) {
            child.kill();
            finish(true);
          } else output += chunk.toString("utf8");
        });
        child.stderr.on("data", () => {
        });
        child.on("error", () => finish(true));
        child.on("close", (code) => finish(code !== 0, output.trim()));
        child.stdin.on("error", () => finish(true));
        child.stdin.end(JSON.stringify(input2));
      });
    }
    var DPAPI_SCRIPT = "$ErrorActionPreference='Stop'; try { $null=[Reflection.Assembly]::LoadWithPartialName('System.Security'); $r=[Console]::In.ReadToEnd() | ConvertFrom-Json; $d=[Convert]::FromBase64String($r.data); $e=[Text.Encoding]::UTF8.GetBytes($r.entropy); if($r.operation -eq 'protect') { $o=[Security.Cryptography.ProtectedData]::Protect($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser) } elseif($r.operation -eq 'unprotect') { $o=[Security.Cryptography.ProtectedData]::Unprotect($d,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser) } else { throw 'invalid' }; [Console]::Out.Write([Convert]::ToBase64String($o)); [Array]::Clear($d,0,$d.Length); [Array]::Clear($o,0,$o.Length) } catch { exit 1 }";
    async function dpapi(operation, data, context) {
      if (process.platform !== "win32") throw failure("WINDOWS_REQUIRED");
      const result = await powershell(DPAPI_SCRIPT, { operation, data: Buffer.from(data).toString("base64"), entropy: context });
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(result)) throw failure("SECURE_STORAGE_UNAVAILABLE");
      return Buffer.from(result, "base64");
    }
    var ACL_SCRIPT = "$ErrorActionPreference='Stop'; try { $r=[Console]::In.ReadToEnd() | ConvertFrom-Json; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if($r.operation -eq 'identity'){ [Console]::Out.Write($sid); exit 0 }; $directory=[IO.Directory]::Exists($r.path); $a=if($directory){[IO.Directory]::GetAccessControl($r.path)}else{[IO.File]::GetAccessControl($r.path)}; $owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; if($owner -ne $sid -or -not $a.AreAccessRulesProtected){exit 1}; $readOnly=[int64]([Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize); $hasCurrent=$false; foreach($ace in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { if($ace.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow){ $s=$ace.IdentityReference.Value; if($s -ne $sid -and $s -ne 'S-1-5-18'){ $rights=[int64]$ace.FileSystemRights; if(-not $directory -or ($rights -band (-bnot $readOnly)) -ne 0){exit 1} }; if($s -eq $sid -and (($ace.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)){$hasCurrent=$true} } }; if(-not $hasCurrent){exit 1}; [Console]::Out.Write('ok') } catch { exit 1 }";
    async function verifyWindowsAcl(target) {
      const answer = await powershell(ACL_SCRIPT, { operation: "verify", path: target });
      if (answer !== "ok") throw failure("UNSAFE_STORE_ACL");
    }
    async function tightenNew(target, directory) {
      const sid = await powershell(ACL_SCRIPT, { operation: "identity" });
      if (!/^S-1-5-\d+(?:-\d+)+$/.test(sid)) throw failure("SECURE_STORAGE_UNAVAILABLE");
      const rights = directory ? "(OI)(CI)F" : "F";
      try {
        await runFile("icacls.exe", [target, "/setowner", "*" + sid], { windowsHide: true, timeout: 15e3, maxBuffer: 16384 });
        await runFile("icacls.exe", [target, "/inheritance:r", "/grant:r", "*" + sid + ":" + rights, "*S-1-5-18:" + rights], { windowsHide: true, timeout: 15e3, maxBuffer: 16384 });
      } catch (_) {
        throw failure("SECURE_STORAGE_UNAVAILABLE");
      }
      await verifyWindowsAcl(target);
    }
    async function plainFile(target, maxBytes) {
      const st = await fs.lstat(target, { bigint: true });
      if (!st.isFile() || st.isSymbolicLink() || st.size > maxBytes) throw failure("INVALID_FILE");
      const canonical = await fs.realpath(target);
      const equal = process.platform === "win32" ? canonical.toLowerCase() === path.resolve(target).toLowerCase() : canonical === path.resolve(target);
      if (!equal) throw failure("INVALID_FILE");
      const handle = await fs.open(target, "r");
      try {
        const now = await handle.stat({ bigint: true });
        if (!now.isFile() || process.platform !== "win32" && now.dev !== st.dev || now.ino !== st.ino || now.size > maxBytes) throw failure("INVALID_FILE");
        const data = Buffer.alloc(maxBytes + 1);
        const { bytesRead } = await handle.read(data, 0, data.length, 0);
        if (bytesRead > maxBytes) {
          data.fill(0);
          throw failure("INVALID_FILE");
        }
        return data.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    }
    function createStore(options = {}) {
      const root = path.resolve(options.root || path.join(os.homedir(), ".oppie-github"));
      const file = path.join(root, "accounts.json");
      const platform = options.platform || process.platform;
      const linux = platform === "linux" ? require_linux_security() : null;
      const protect = options.protect || (linux ? linux.protect : ((data, context) => dpapi("protect", data, context)));
      const unprotect = options.unprotect || (linux ? linux.unprotect : ((data, context) => dpapi("unprotect", data, context)));
      const checkAcl = options.checkAcl || (linux ? linux.verifyAcl : verifyWindowsAcl);
      const tighten = options.tighten || (linux ? linux.tightenNew : tightenNew);
      let queue = Promise.resolve();
      function serial(fn) {
        const result = queue.then(fn, fn);
        queue = result.catch(() => {
        });
        return result;
      }
      async function ensureRoot(create = false) {
        if (!["win32", "linux"].includes(platform)) throw failure("UNSUPPORTED_PLATFORM");
        let st;
        try {
          st = await fs.lstat(root);
        } catch (e) {
          if (e.code !== "ENOENT") throw failure("UNSAFE_STORE");
          if (!create) return false;
          try {
            await fs.mkdir(root, { recursive: false });
            await tighten(root, true);
            st = await fs.lstat(root);
          } catch (_) {
            throw failure("UNSAFE_STORE");
          }
        }
        if (!st.isDirectory() || st.isSymbolicLink()) throw failure("UNSAFE_STORE");
        const actual = await fs.realpath(root);
        if (platform === "win32" ? actual.toLowerCase() !== root.toLowerCase() : actual !== root) throw failure("UNSAFE_STORE");
        try {
          await checkAcl(root);
        } catch (_) {
          throw failure("UNSAFE_STORE_ACL");
        }
        return true;
      }
      function validateRow(row) {
        const fixed = metadata(row?.account);
        for (const k of Object.keys(fixed)) {
          if (k === "appSlug") {
            if (!allowedAppSlug(fixed.account, row[k])) throw failure("INVALID_STORE");
          } else if (JSON.stringify(row[k]) !== JSON.stringify(fixed[k])) throw failure("INVALID_STORE");
        }
        if (!/^[a-f0-9]{64}$/.test(row.fingerprint) || typeof row.ciphertext !== "string" || row.ciphertext.length > 1e5 || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.ciphertext)) throw failure("INVALID_STORE");
        return row;
      }
      async function read() {
        if (!await ensureRoot()) return { version: 1, accounts: [] };
        try {
          await fs.lstat(file);
        } catch (e) {
          if (e.code === "ENOENT") return { version: 1, accounts: [] };
          throw failure("INVALID_STORE");
        }
        let bytes;
        try {
          await checkAcl(file);
          bytes = await plainFile(file, MAX_STORE);
          const doc = JSON.parse(bytes.toString("utf8"));
          if (doc.version !== 1 || !Array.isArray(doc.accounts) || doc.accounts.length > 12) throw Error();
          const seen = /* @__PURE__ */ new Set();
          for (const row of doc.accounts) {
            validateRow(row);
            if (seen.has(row.account)) throw Error();
            seen.add(row.account);
          }
          return doc;
        } catch (_) {
          throw failure("INVALID_OR_UNSAFE_STORE");
        } finally {
          bytes?.fill(0);
        }
      }
      function publicRow(row) {
        const { ciphertext, ...visible } = row;
        return { ...visible, expectedAppSlug: ACCOUNTS[row.account].app_slug, appSlugStatus: "stored_not_live" };
      }
      async function save(doc) {
        await ensureRoot(true);
        const temporary = path.join(root, ".accounts-" + crypto.randomBytes(12).toString("hex") + ".tmp");
        let handle;
        try {
          handle = await fs.open(temporary, "wx", 384);
          await handle.close();
          handle = null;
          await tighten(temporary, false);
          await checkAcl(root);
          handle = await fs.open(temporary, "r+");
          await handle.writeFile(JSON.stringify(doc));
          await handle.sync();
          await handle.close();
          handle = null;
          try {
            await fs.lstat(file);
            await checkAcl(file);
            await plainFile(file, MAX_STORE);
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          await fs.rename(temporary, file);
          await checkAcl(file);
        } catch (_) {
          throw failure("STORE_WRITE_FAILED");
        } finally {
          await handle?.close().catch(() => {
          });
          await fs.unlink(temporary).catch(() => {
          });
        }
      }
      async function importKey(args) {
        return serial(async () => {
          const fixed = metadata(args?.account);
          if (args.expected_fingerprint !== void 0 && !/^[a-f0-9]{64}$/.test(args.expected_fingerprint)) throw failure("INVALID_EXPECTED_FINGERPRINT");
          const supplied = args.pem_path || args.pemPath;
          if (typeof supplied !== "string" || !path.isAbsolute(supplied) || path.extname(supplied).toLowerCase() !== ".pem") throw failure("INVALID_PEM_PATH");
          if (args.metadata) for (const [k, v] of Object.entries(args.metadata)) {
            if (k === "appSlug") {
              if (!allowedAppSlug(fixed.account, v)) throw failure("ACCOUNT_METADATA_MISMATCH");
            } else if (JSON.stringify(fixed[k]) !== JSON.stringify(v)) throw failure("ACCOUNT_METADATA_MISMATCH");
          }
          const doc = await read();
          const previous = doc.accounts.find((x) => x.account === fixed.account);
          if (previous && !args.replace) throw failure("ACCOUNT_EXISTS");
          let bytes;
          try {
            bytes = await plainFile(supplied, MAX_PEM);
            const key = crypto.createPrivateKey(bytes);
            if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048) throw failure("INVALID_RSA_KEY");
            const pub = crypto.createPublicKey(key).export({ type: "spki", format: "der" });
            const fingerprint = crypto.createHash("sha256").update(pub).digest("hex");
            if (args.expected_fingerprint !== void 0 && fingerprint !== args.expected_fingerprint) throw failure("KEY_CHANGED_DURING_IMPORT");
            const sealed = await protect(bytes, entropy(fixed.account));
            const row = { ...fixed, appSlug: args.metadata?.appSlug || fixed.appSlug, fingerprint, importedAt: (/* @__PURE__ */ new Date()).toISOString(), ciphertext: Buffer.from(sealed).toString("base64") };
            doc.accounts = doc.accounts.filter((x) => x.account !== fixed.account).concat(row);
            await save(doc);
            return publicRow(row);
          } catch (e) {
            if (["STORE_WRITE_FAILED", "UNSAFE_STORE", "UNSAFE_STORE_ACL", "WINDOWS_REQUIRED", "SECURE_STORAGE_UNAVAILABLE", "KEY_CHANGED_DURING_IMPORT"].includes(e.code)) throw e;
            throw failure("KEY_IMPORT_FAILED");
          } finally {
            bytes?.fill(0);
          }
        });
      }
      async function load(account) {
        metadata(account);
        await queue;
        const doc = await read();
        const row = doc.accounts.find((x) => x.account === account);
        if (!row) throw failure("ACCOUNT_NOT_CONNECTED");
        let plain;
        try {
          plain = await unprotect(Buffer.from(row.ciphertext, "base64"), entropy(account));
          const key = crypto.createPrivateKey(plain);
          if (key.asymmetricKeyType !== "rsa") throw Error();
          const fingerprint = crypto.createHash("sha256").update(crypto.createPublicKey(key).export({ type: "spki", format: "der" })).digest("hex");
          if (fingerprint !== row.fingerprint) throw Error();
          return { ...publicRow(row), privateKey: Buffer.from(plain).toString("utf8") };
        } catch (e) {
          if (e.code === "SECURE_STORAGE_UNAVAILABLE") throw e;
          throw failure("KEY_UNAVAILABLE");
        } finally {
          plain?.fill(0);
        }
      }
      async function list() {
        await queue;
        return (await read()).accounts.map(publicRow);
      }
      return { importKey, load, list, paths: { root, file }, backendName: linux ? linux.backendName : "Windows DPAPI CurrentUser" };
    }
    var defaultStore = createStore();
    module2.exports = { ...defaultStore, createStore, metadata, APP_IDS, INSTALL_IDS };
  }
});

// deployment.json
var require_deployment = __commonJS({
  "deployment.json"(exports2, module2) {
    module2.exports = {
      accounts: [
        "bb",
        "cindy",
        "deja",
        "dd",
        "gg",
        "jj",
        "pg",
        "qq",
        "rea",
        "video",
        "vv",
        "reviewinbox"
      ],
      automaticReviews: false
    };
  }
});

// src/review-cli.cjs
var { createClient } = require_core();
var store = require_store();
var deployment = require_deployment();
var input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (Buffer.byteLength(input) > 262144) {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: "INPUT_TOO_LARGE" }) + "\n");
    process.exit(1);
  }
});
process.stdin.on("end", async () => {
  try {
    const r = JSON.parse(input);
    if (!r || Array.isArray(r) || Object.keys(r).some((k) => !["repo", "operation", "args"].includes(k))) throw Error();
    if (!deployment.accounts.includes("reviewinbox") || !["identity", "get_pull", "pull_files", "list_reviews", "submit_review"].includes(r.operation)) throw Error();
    if (r.operation === "submit_review" && r.args?.event !== "COMMENT") throw Error();
    const result = await createClient({ credentials: async () => (await store.load("reviewinbox")).privateKey }).run({ account: "reviewinbox", ...r });
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.ok ? 0 : 1;
  } catch (_) {
    process.stdout.write(JSON.stringify({ ok: false, errorCode: "REVIEW_REQUEST_REFUSED" }) + "\n");
    process.exitCode = 1;
  }
});
