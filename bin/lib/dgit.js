import CID from "cids";
import IPLDGit from "ipld-git";
// tslint:disable-next-line:no-submodule-imports
import pkg from "ipld-git/src/util/util.js";
const { cidToSha, shaToCid } = pkg;
import URL from "url-parse";

export default class DGitHelper {
  // OK
  constructor(helper) {
    this.helper = helper;
  }

  // OK
  async deserialize(buffer) {
    return new ((resolve, reject) => {
      IPLDGit.util.deserialize(buffer, (err, node) => {
        if (err) {
          reject(err);
        } else {
          resolve(node);
        }
      });
    })();
  }

  // OK
  async serialize(node) {
    return new ((resolve, reject) => {
      IPLDGit.util.serialize(node, async (err, buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(buffer);
        }
      });
    })();
  }

  // OK
  async put(object) {}

  // OK
  async get(cid) {}

  // OK
  async pin(cid) {}

  // OK
  async cid(object) {}

  // OK
  shaToCid(oid) {
    return new CID(shaToCid(Buffer.from(oid, "hex"))).toBaseEncodedString();
  }

  // OK
  cidToSha(cid) {
    return cidToSha(new CID(cid)).toString("hex");
  }
}
