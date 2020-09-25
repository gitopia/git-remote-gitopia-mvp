import debug from "debug";
import fs from "fs-extra";
import npath from "path";
import shell from "shelljs";
// tslint:disable-next-line:no-submodule-imports
import gitP from "simple-git/promise.js";

import { fetchGitObject } from "./arweave.js";

const git = gitP();

export default class GitHelper {
  // OK
  constructor(helper) {
    this.helper = helper;
    this.debug = debug("dgit");
  }

  /***** core methods *****/

  // OK
  async collect(oid) {
    this.debug("collecting", oid);
  }

  // OK
  async download(oid) {
    this.debug("downloading", oid);

    if (await this.exists(oid)) return;

    const object = await fetchGitObject(
      this.helper._arweave,
      this.helper.url,
      oid
    );

    await this.dump(oid, object);

    // if commit expand the tree
    console.error(git.catFile([oid]));
  }

  /***** fs-related methods *****/

  // OK
  async exists(oid) {
    // modify this function to rely on git cat-file -e $sha^{commit}
    // see https://stackoverflow.com/questions/18515488/how-to-check-if-the-commit-exists-in-a-git-repository-by-its-sha-1
    return fs.pathExists(await this.path(oid));
  }

  // OK
  async load(oid) {
    const path = await this.path(oid);
    await fs.ensureFile(path);
    return fs.readFileSync(path);
  }

  // OK
  async dump(oid, object) {
    const path = await this.path(oid);
    await fs.ensureFile(path);
    fs.writeFileSync(path, object);
  }

  /***** utility methods *****/

  // OK
  async path(oid) {
    const subdirectory = oid.substring(0, 2);
    const filename = oid.substring(2);

    return npath.join(this.helper.path, "objects", subdirectory, filename);
  }
}
