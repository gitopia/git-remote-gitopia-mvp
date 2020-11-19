import * as smartweave from "smartweave";
import shell from "shelljs";
import pkg from "bignumber.js";
const { BigNumber } = pkg;

import { VERSION } from "../helper.js";
import { newProgressBar } from "./util.js";

// prettier-ignore
const argitRemoteURIRegex = '^gitopia:\/\/([a-zA-Z0-9-_]{43})\/([A-Za-z0-9_.-]*)'
const contractId = "1ljLAR55OhtenU0iDWkLGT6jF4ApxeQd5P0gXNyNJXg";

export function parseArgitRemoteURI(remoteURI) {
  const matchGroups = remoteURI.match(argitRemoteURIRegex);
  const repoOwnerAddress = matchGroups[1];
  const repoName = matchGroups[2];

  return { repoOwnerAddress, repoName };
}

export async function makeUpdateRefTx(
  arweave,
  wallet,
  remoteURI,
  ref,
  oid,
  bundledDataTxs
) {
  const { repoName } = parseArgitRemoteURI(remoteURI);
  const numCommits = shell
    .exec(`git rev-list --count ${ref}`, { silent: true })
    .stdout.trim();
  const obj = {
    oid,
    numCommits,
  };
  const data = JSON.stringify(obj);

  const tx = await arweave.createTransaction({ data }, wallet);

  tx.addTag("Repo", repoName);
  tx.addTag("Version", "0.0.2");
  tx.addTag("Ref", ref);
  tx.addTag("Type", "update-ref");
  tx.addTag("App-Name", "Gitopia");
  tx.addTag("Unix-Time", Math.round(new Date().getTime() / 1000).toString());
  tx.addTag("Content-Type", "application/json");
  tx.addTag("Helper", VERSION);

  // Push triggered from gitopia mirror action
  if (process.env.GITHUB_SHA) {
    tx.addTag("Origin", "gitopia-mirror-action");
  } else {
    tx.addTag("Origin", "git-remote-gitopia");
  }

  const bundledDataTxIds = [];
  for (let i = 0; i < bundledDataTxs.length; i++) {
    bundledDataTxIds.push(bundledDataTxs[i].id);
  }

  tx.addTag("Reference-Txs", JSON.stringify(bundledDataTxIds));

  await arweave.transactions.sign(tx, wallet);
  return tx;
}

export const makeDataItem = async (
  arData,
  wallet,
  remoteURI,
  oid,
  objectBuf
) => {
  const { repoName } = parseArgitRemoteURI(remoteURI);
  const tags = [
    { name: "Oid", value: oid },
    { name: "Version", value: "0.0.2" },
    { name: "Repo", value: repoName },
    { name: "Type", value: "git-object" },
    { name: "App-Name", value: "Gitopia" },
    {
      name: "Unix-Time",
      value: Math.round(new Date().getTime() / 1000).toString(),
    },
    { name: "Content-Type", value: "application/octet-stream" },
  ];

  const item = await arData.createData({ data: objectBuf, tags }, wallet);
  return await arData.sign(item, wallet);
};

export const makeBundledDataTx = async (
  arweave,
  arData,
  wallet,
  remoteURI,
  dataItems
) => {
  const { repoName } = parseArgitRemoteURI(remoteURI);
  const bundle = await arData.bundleData(dataItems);
  const data = JSON.stringify(bundle);
  const tx = await arweave.createTransaction({ data }, wallet);
  tx.addTag("Repo", repoName);
  tx.addTag("Version", "0.0.2");
  tx.addTag("Type", "git-objects-bundle");
  tx.addTag("App-Name", "Gitopia");
  tx.addTag("Bundle-Format", "json");
  tx.addTag("Bundle-Version", "1.0.0");
  tx.addTag("Content-Type", "application/json");
  tx.addTag("Unix-Time", Math.round(new Date().getTime() / 1000).toString());

  await arweave.transactions.sign(tx, wallet);
  return tx;
};

export const postTransaction = async (arweave, tx) => {
  const uploader = await arweave.transactions.getUploader(tx);

  const bar = newProgressBar();
  bar.start(uploader.totalChunks, 0);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    bar.update(uploader.uploadedChunks);
  }

  bar.stop();
};

export const sendPSTFee = async (
  arweave,
  wallet,
  remoteURI,
  transactions,
  referenceId
) => {
  const { repoName } = parseArgitRemoteURI(remoteURI);
  const contractState = await smartweave.default.readContract(
    arweave,
    contractId
  );
  const holder = smartweave.default.selectWeightedPstHolder(
    contractState.balances
  );

  // PST Fee
  let totalTxFee = new BigNumber(0);
  for (let i = 0; i < transactions.length; i++) {
    const txFee = new BigNumber(transactions[i].reward);
    totalTxFee = totalTxFee.plus(txFee);
  }

  const pstFee = totalTxFee.multipliedBy(0.1);

  const quantity = pstFee.isGreaterThan(
    BigNumber(arweave.ar.arToWinston("0.01"))
  )
    ? pstFee.toFixed(0)
    : arweave.ar.arToWinston("0.01");

  const pstTx = await arweave.createTransaction(
    { target: holder, quantity },
    wallet
  );
  pstTx.addTag("Reference-Id", referenceId);
  pstTx.addTag("Repo", repoName);
  pstTx.addTag("Version", "0.0.2");
  pstTx.addTag("App-Name", "Gitopia");
  pstTx.addTag("Unix-Time", Math.round(new Date().getTime() / 1000).toString());

  await arweave.transactions.sign(pstTx, wallet);
  await arweave.transactions.post(pstTx);
};
