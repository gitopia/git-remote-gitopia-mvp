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
import Arweave from "arweave";
import {
  pushGitObject,
  makeDataItem,
  makeUpdateRefDataItem,
  parseArgitRemoteURI,
  postBundledTransaction,
} from "./lib/arweave.js";
import { getAllRefs } from "./lib/graphql.js";

import * as deepHash from "arweave/node/lib/deepHash.js";
import ArweaveData from "arweave-data/pkg/dist-node/index.js";
import pkg from "cli-progress";
const { SingleBar, Presets } = pkg;

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
    this.arweaveWalletPath = process.env.ARWEAVE_WALLET_PATH;
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
    // fs.ensureDirSync(path.join(this.path, "refs", "remotes", this.name));
    // fs.ensureDirSync(path.join(this.path, "dgit", "refs"));
    this._arweave = Arweave.init({
      host: "arweave.net",
      port: 443,
      protocol: "https",
    });
    const deps = {
      utils: Arweave.utils,
      crypto: Arweave.crypto,
      deepHash: deepHash.default.default,
    };
    this.ArData = ArweaveData.default(deps);
  }

  // OK
  async run() {
    while (true) {
      const cmd = await this.line.next();

      switch (this._cmd(cmd)) {
        case "capabilities":
          await this._handleCapabilities();
          break;
        case "list for-push":
          await this._handleList({ forPush: true });
          break;
        case "list":
          await this._handleList({});
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
    console.error("refs", refs);
    // tslint:disable-next-line:forin
    for (const ref in refs) {
      this._send(refs[ref] + " " + ref);
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

    if (!this.arweaveWalletPath) {
      console.error("Missing ARWEAVE_WALLET_PATH env variable");
      this._die();
    }

    const rawdata = fs.readFileSync(this.arweaveWalletPath);
    this.wallet = JSON.parse(rawdata);

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
    this.debug("fetching remote refs from arweave");

    let start;
    let block;
    let events;
    const ops = [];
    const spinner = ora("Fetching remote refs from arweave").start();

    try {
      const refs = await getAllRefs(this._arweave, this.url);

      spinner.succeed("Remote refs fetched from arweave");
      return refs;
    } catch (err) {
      spinner.fail("Failed to fetch remote refs from arweave");
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
    this.debug("fetching", ref, oid);
    await this.git.download(oid);
  }

  // OK
  async _push(src, dst) {
    this.debug("pushing", src, "to", dst);

    return (async (resolve, reject) => {
      let spinner;
      let txHash;
      let mapping = {};
      const puts = [];
      const pins = [];

      try {
        const refs = await this._fetchRefs();
        const remote = refs[dst];

        const srcBranch = src.split("/").pop();
        const dstBranch = dst.split("/").pop();

        const revListCmd = remote
          ? `git rev-list --objects --left-only ${srcBranch}...${this.name}/${dstBranch}`
          : `git rev-list --objects ${srcBranch}`;

        const objects = shell
          .exec(revListCmd, { silent: true })
          .stdout.split("\n")
          .slice(0, -1)
          .map((object) => object.substr(0, 40));

        // checking permissions
        try {
          spinner = ora(`Checking permissions over ${this.address}`).start();
          // check push permission for repo
          const address = await this._arweave.wallets.jwkToAddress(this.wallet);
          const { repoOwnerAddress } = parseArgitRemoteURI(this.url);

          if (address === repoOwnerAddress) {
            spinner.succeed(`You have push permission over ${this.address}`);
          } else {
            spinner.fail(
              `You do not have push permission over ${this.address}.`
            );
            this._die();
          }
        } catch (err) {
          spinner.fail(
            `Failed to check permissions over ${this.address}: ` + err.message
          );
          this._die();
        }

        // update ref
        puts.push(
          makeUpdateRefDataItem(
            this.ArData,
            this.wallet,
            this.url,
            dst,
            objects[0]
          )
        );

        // collect git objects
        spinner = ora("Collecting git objects [this may take a while]").start();

        const bar1 = new SingleBar(
          { stream: process.stderr },
          Presets.shades_classic
        );

        bar1.start(objects.length, 0);

        try {
          objects.map((oid) =>
            puts.push(
              (async (bar) => {
                bar.increment();

                const object = await this.git.load(oid);
                const dataItem = await makeDataItem(
                  this.ArData,
                  this.wallet,
                  this.url,
                  oid,
                  object
                );
                return dataItem;
              })(bar1)
            )
          );

          spinner.succeed("Git objects collected");
        } catch (err) {
          spinner.fail("Failed to collect git objects: " + err.message);
          this._die();
        }

        // upload git objects
        try {
          spinner = ora("Uploading git objects to arweave").start();
          const dataItems = await Promise.all(puts);
          bar1.stop();
          await postBundledTransaction(
            this._arweave,
            this.ArData,
            this.wallet,
            this.url,
            dataItems
          );
          spinner.succeed("Git objects uploaded to arweave");
        } catch (err) {
          spinner.fail(
            "Failed to upload git objects to arweave: " + err.message
          );
          this._die();
        }

        // register on chain
        try {
          spinner = ora(`Updating ref ${dst} ${objects[0]} on arweave`).start();
          spinner.succeed(`Updated ref ${dst} ${objects[0]} successfully`);
        } catch (err) {
          spinner.fail(
            `Failed to update ref ${dst} ${objects[0]} on arweave: ` +
              err.message
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
