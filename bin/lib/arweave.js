import * as smartweave from "smartweave";

// prettier-ignore
const argitRemoteURIRegex = '^dgit:\/\/([a-zA-Z0-9-_]{43})\/([A-Za-z0-9_.-]*)'
const contractId = "UvjBvJUy8pOMR_lf85tBDaJD0jF85G5Ayj1p2h7yols";

const repoQuery = (remoteURI) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  return {
    op: "and",
    expr1: {
      op: "and",
      expr1: {
        op: "equals",
        expr1: "App-Name",
        expr2: "dgit",
      },
      expr2: {
        op: "equals",
        expr1: "from",
        expr2: repoOwnerAddress,
      },
    },
    expr2: { op: "equals", expr1: "Repo", expr2: repoName },
  };
};

export function parseArgitRemoteURI(remoteURI) {
  const matchGroups = remoteURI.match(argitRemoteURIRegex);
  const repoOwnerAddress = matchGroups[1];
  const repoName = matchGroups[2];

  return { repoOwnerAddress, repoName };
}

function addTransactionTags(tx, repo, txType) {
  tx.addTag("Repo", repo);
  tx.addTag("Type", txType);
  tx.addTag("App-Name", "dgit");
  tx.addTag("version", "0.0.1");
  tx.addTag("Unix-Time", Math.round(new Date().getTime() / 1000)); // Add Unix timestamp
  return tx;
}

export async function makeUpdateRefDataItem(
  arData,
  wallet,
  remoteURI,
  name,
  ref
) {
  const { repoName } = parseArgitRemoteURI(remoteURI);
  const tags = [
    { name: "App-Name", value: "dgit" },
    { name: "version", value: "0.0.1" },
    { name: "Repo", value: repoName },
    { name: "Type", value: "update-ref" },
    {
      name: "Unix-Time",
      value: Math.round(new Date().getTime() / 1000).toString(),
    },
    { name: "ref", value: name },
    { name: "Content-Type", value: "text/plain" },
  ];

  const item = await arData.createData({ data: ref, tags }, wallet);
  return await arData.sign(item, wallet);
}

export async function pushGitObject(arweave, wallet, remoteURI, oid, object) {
  const { repoName } = parseArgitRemoteURI(remoteURI);

  let tx = await arweave.createTransaction({ data: object }, wallet);
  tx = addTransactionTags(tx, repoName, "push-git-object");
  tx.addTag("oid", oid);
  tx.addTag("Content-Type", "application/octet-stream");

  await arweave.transactions.sign(tx, wallet);
  let uploader = await arweave.transactions.getUploader(tx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    // console.error(
    //   `${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`
    // );
  }
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
    { name: "App-Name", value: "dgit" },
    { name: "version", value: "0.0.1" },
    { name: "Repo", value: repoName },
    { name: "Type", value: "push-git-object" },
    {
      name: "Unix-Time",
      value: Math.round(new Date().getTime() / 1000).toString(),
    },
    { name: "oid", value: oid },
    { name: "Content-Type", value: "application/octet-stream" },
  ];

  const item = await arData.createData({ data: objectBuf, tags }, wallet);
  return await arData.sign(item, wallet);
};

export const postBundledTransaction = async (
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
  tx.addTag("Bundle-Format", "json");
  tx.addTag("Bundle-Version", "1.0.0");
  tx.addTag("Content-Type", "application/json");
  tx.addTag("App-Name", "dgit");
  tx.addTag("Type", "git-objects-bundle");
  tx.addTag("Repo", repoName);

  await arweave.transactions.sign(tx, wallet);
  const uploader = await arweave.transactions.getUploader(tx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    console.error(
      `${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`
    );
  }

  // Send fee to PST holders
  const contractState = await smartweave.readContract(arweave, contractId);
  const holder = smartweave.selectWeightedPstHolder(contractState.balances);
  // send a fee. You should inform the user about this fee and amount.
  const pstTx = await arweave.createTransaction(
    { target: holder, quantity: arweave.ar.arToWinston("0.01") },
    wallet
  );
  pstTx.addTag("App-Name", "dgit");
  pstTx.addTag("version", "0.0.1");
  pstTx.addTag("Repo", repoName);

  await arweave.transactions.sign(pstTx, wallet);
  await arweave.transactions.post(pstTx);
};

export async function fetchGitObjects(arweave, arData, remoteURI) {
  const query = {
    op: "and",
    expr1: repoQuery(remoteURI),
    expr2: { op: "equals", expr1: "Type", expr2: "push-git-object" },
  };
  const txids = await arweave.arql(query);
  const objects = await Promise.all(
    txids.map(async (txid) => {
      const tx = await arweave.transactions.get(txid);
      let oid = "";
      tx.get("tags").forEach((tag) => {
        const key = tag.get("name", { decode: true, string: true });
        const value = tag.get("value", { decode: true, string: true });
        if (key === "oid") oid = value;
      });
      const data = await arweave.transactions.getData(txid, { decode: true });
      return { data, oid };
    })
  );
  return objects;
}
