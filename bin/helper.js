import debug from "debug";
import fs from "fs-extra";
import json from "jsonfile";
import Level from "level";
import ora from "ora";
import os from "os";
import path from "path";
import shell from "shelljs";
import GitHelper from "./lib/git.js";
import DGitHelper from "./lib/dgit.js";
import LineHelper from "./lib/line.js";

const _timeout = async (duration) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
};

export default class Helper {
  // name and url
  //   public name: string
  //   public url: string
  //   // address and path shortcuts
  //   public address: string
  //   public path: string
  //   // config
  //   public config: any
  //   // lib
  //   public debug: any
  //   public line: LineHelper
  //   public git: GitHelper
  //   public dgit: dgitHelper
  //   // db
  //   private _db: any
  //   private _provider: any
  //   // artifacts and contracts
  //   private _repo!: any
  //   private _kernel!: any

  constructor(name = "_", url) {
    // name and url
    this.name = name;
    this.url = url;
    // address and path shortcuts
    this.address = this.url.split("://")[1];
    this.path = path.resolve(process.env.GIT_DIR || "");
    // config
    this.config = this._config();
    // lib
    this.debug = debug("dgit");
    this.line = new LineHelper();
    this.git = new GitHelper(this);
    this.dgit = new DGitHelper(this);
  }

  // OK
  async initialize() {
    // create dirs
    fs.ensureDirSync(path.join(this.path, "refs", "remotes", this.name));
    fs.ensureDirSync(path.join(this.path, "dgit", "refs"));
    // load db
    this._db = Level(path.join(this.path, "dgit", "refs", this.address));
  }

  // OK
  async run() {
    while (true) {
      const cmd = await this.line.next();
      console.log(cmd);
      switch (this._cmd(cmd)) {
        case "capabilities":
          await this._handleCapabilities();
          break;
        case "list for-push":
          await this._handleList({ forPush: true });
          break;
        case "list":
          await this._handleList();
          break;
        case "fetch":
          await this._handleFetch(cmd);
          break;
        case "push":
          await this._handlePush(cmd);
          break;
        case "end":
          this._exit();
        case "unknown":
          throw new Error("Unknown command: " + cmd);
      }
    }
  }

  /***** commands handling methods *****/

  // OK
  async _handleCapabilities() {
    this.debug("cmd", "capabilities");
    // this._send('option')
    this._send("fetch");
    this._send("push");
    this._send("");
  }

  // OK
  async _handleList({ forPush = false }) {
    forPush ? this.debug("cmd", "list", "for-push") : this.debug("cmd, list");

    const refs = await this._fetchRefs();

    // tslint:disable-next-line:forin
    for (const ref in refs) {
      this._send(this.dgit.cidToSha(refs[ref]) + " " + ref);
    }

    // force HEAD to master and update once dgit handle symbolic refs
    this._send("@refs/heads/master" + " " + "HEAD");
    this._send("");
  }

  // OK
  async _handleFetch(line) {
    this.debug("cmd", line);

    while (true) {
      const [cmd, oid, name] = line.split(" ");
      await this._fetch(oid, name);
      line = await this.line.next();

      if (line === "") break;
    }

    this._send("");
  }

  // OK
  async _handlePush(line) {
    this.debug("cmd", line);

    while (true) {
      const [src, dst] = line.split(" ")[1].split(":");

      if (src === "") {
        await this._delete(dst);
      } else {
        await this._push(src, dst);
      }

      line = await this.line.next();

      if (line === "") break;
    }

    this._send("");
  }

  /***** refs db methods *****/

  // OK
  async _fetchRefs() {
    this.debug("fetching remote refs from chain");

    let start;
    let block;
    let events;
    const ops = [];
    const updates = {};
    const spinner = ora(
      "Fetching remote refs from chain [this may take a while]"
    ).start();

    try {
      start = await this._db.get("@block");
    } catch (err) {
      if (err.message === "Key not found in database [@block]") {
        start = 0;
      } else {
        throw err;
      }
    }

    try {
      // get refs from dgit node
      //   events = await this._repo.contract.getPastEvents("UpdateRef", {
      //     fromBlock: start,
      //     toBlock: "latest",
      //   });
      events = [{ ref: "", hash: "" }];

      for (const event of events) {
        updates[event.ref] = event.hash;
      }

      // tslint:disable-next-line:forin
      for (const ref in updates) {
        ops.push({ type: "put", key: ref, value: updates[ref] });
      }

      ops.push({ type: "put", key: "@block", value: block });

      await this._db.batch(ops);

      spinner.succeed("Remote refs fetched from chain");

      return this._getRefs();
    } catch (err) {
      spinner.fail("Failed to fetch remote refs from chain");
      throw err;
    }
  }

  // OK
  async _getRefs() {
    this.debug("reading refs from local db");

    const refs = {};

    return new ((resolve, reject) => {
      this._db
        .createReadStream()
        .on("data", (ref) => {
          if (ref.key !== "@block") refs[ref.key] = ref.value;
        })
        .on("error", (err) => {
          reject(err);
        })
        .on("end", () => {
          //
        })
        .on("close", () => {
          resolve(refs);
        });
    })();
  }

  /***** core methods *****/

  // OK
  async _fetch(oid, ref) {
    this.debug("fetching", ref, oid, this.dgit.shaToCid(oid));
    await this.git.download(oid);
  }

  // OK
  async _push(src, dst) {
    this.debug("pushing", src, "to", dst);

    return new (async (resolve, reject) => {
      let spinner;
      let head;
      let txHash;
      let mapping = {};
      const puts = [];
      const pins = [];

      try {
        const refs = await this._getRefs();
        const remote = refs[dst];

        const srcBranch = src.split("/").pop();
        const dstBranch = dst.split("/").pop();

        const revListCmd = remote
          ? `git rev-list --left-only ${srcBranch}...${this.name}/${dstBranch}`
          : "git rev-list --all";

        const commits = shell
          .exec(revListCmd, { silent: true })
          .stdout.split("\n")
          .slice(0, -1);

        // checking permissions
        try {
          spinner = ora(`Checking permissions over ${this.address}`).start();

          if (
            true // check owner permission for repo
          ) {
            spinner.succeed(`You have open PR permission over ${this.address}`);
          } else {
            spinner.fail(
              `You do not have open PR permission over ${this.address}`
            );
            this._die();
          }
          if (
            true // check push permissions
          ) {
            spinner.succeed(`You have push permission over ${this.address}`);
          } else {
            spinner.fail(
              `You do not have push permission over ${this.address}. Try to run 'git dgit pr open' to open a push request.`
            );
            this._die();
          }
        } catch (err) {
          spinner.fail(
            `Failed to check permissions over ${this.address}: ` + err.message
          );
          this._die();
        }

        // collect git objects
        try {
          spinner = ora(
            "Collecting git objects [this may take a while]"
          ).start();

          for (const commit of commits) {
            const _mapping = await this.git.collect(commit, mapping);
            mapping = { ...mapping, ..._mapping };
          }

          head = this.dgit.shaToCid(commits[0]);

          // tslint:disable-next-line:forin
          for (const entry in mapping) {
            puts.push(this.dgit.put(mapping[entry]));
          }

          spinner.succeed("Git objects collected");
        } catch (err) {
          spinner.fail("Failed to collect git objects: " + err.message);
          this._die();
        }

        // upload git objects
        try {
          spinner = ora("Uploading git objects to IPFS").start();
          await Promise.all(puts);
          spinner.succeed("Git objects uploaded to IPFS");
        } catch (err) {
          spinner.fail("Failed to upload git objects to IPFS: " + err.message);
          this._die();
        }

        // pin git objects
        try {
          // tslint:disable-next-line:forin
          for (const entry in mapping) {
            pins.push(this.dgit.pin(entry));
          }
          spinner = ora("Pinning git objects to IPFS").start();
          await Promise.all(pins);
          spinner.succeed("Git objects pinned to IPFS");
        } catch (err) {
          spinner.fail("Failed to pin git objects to IPFS: " + err.message);
          this._die();
        }

        // register on chain
        try {
          spinner = ora(`Registering ref ${dst} ${head} on-chain`).start();
        } catch (err) {
          spinner.fail(
            `Failed to register ref ${dst} ${head} on-chain: ` + err.message
          );
          this._die();
        }
      } catch (err) {
        this._die(err.message);
      }
    })();
  }

  // TODO
  async _delete(dst) {
    this.debug("deleting", dst);
  }

  /***** utility methods *****/

  // OK

  // OK
  _config() {
    return { gateway: "arweave.net" };
    // const LOCAL = path.join(this.path, "dgit", ".dgitrc");
    // const GLOBAL = path.join(os.homedir(), ".dgitrc");

    // if (fs.pathExistsSync(LOCAL)) return json.readFileSync(LOCAL);
    // if (fs.pathExistsSync(GLOBAL)) return json.readFileSync(GLOBAL);

    // this._die(
    //   "No configuration file found. Run 'git-dgit config' and come back to us."
    // );
  }

  // OK
  _cmd(line) {
    console.log(line);
    if (line === "capabilities") {
      return "capabilities";
    } else if (line === "list for-push") {
      return "list for-push";
    } else if (line === "list") {
      return "list";
    } else if (line.startsWith("option")) {
      return "option";
    } else if (line.startsWith("fetch")) {
      return "fetch";
    } else if (line.startsWith("push")) {
      return "push";
    } else if (line === "") {
      return "end";
    } else {
      return "unknown";
    }
  }

  // OK
  _send(message) {
    // tslint:disable-next-line:no-console
    console.log(message);
  }

  // OK
  _die(message) {
    // tslint:disable-next-line:no-console
    if (message) console.error(message);
    process.exit(1);
  }

  // OK
  _exit() {
    process.exit(0);
  }
}
