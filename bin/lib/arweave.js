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

export async function updateRef(arweave, wallet, remoteURI, name, ref) {
  const { repoName } = parseArgitRemoteURI(remoteURI);
  let tx = await arweave.createTransaction({ data: ref }, wallet);
  tx = addTransactionTags(tx, repoName, "update-ref");
  tx.addTag("ref", name);

  await arweave.transactions.sign(tx, wallet); // Sign transaction
  arweave.transactions.post(tx); // Post transaction
}

export async function getRef(arweave, remoteURI, name) {
  const query = {
    op: "and",
    expr1: repoQuery(remoteURI),
    expr2: {
      op: "and",
      expr1: { op: "equals", expr1: "Type", expr2: "update-ref" },
      expr2: { op: "equals", expr1: "ref", expr2: name },
    },
  };
  const txids = await arweave.arql(query);
  const tx_rows = await Promise.all(
    txids.map(async (txid) => {
      let tx_row = {};
      const tx = await arweave.transactions.get(txid);
      tx.get("tags").forEach((tag) => {
        const key = tag.get("name", { decode: true, string: true });
        const value = tag.get("value", { decode: true, string: true });
        if (key === "Unix-Time") tx_row.unixTime = value;
      });

      tx_row.oid = await arweave.transactions.getData(txid, {
        decode: true,
        string: true,
      });

      return tx_row;
    })
  );

  if (tx_rows.length === 0) return "0000000000000000000000000000000000000000";

  // descending order
  tx_rows.sort((a, b) => {
    Number(b.unixTime) - Number(a.unixTime);
  });
  return tx_rows[0].oid;
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
    console.error(
      `${uploader.pctComplete}% complete, ${uploader.uploadedChunks}/${uploader.totalChunks}`
    );
  }
}

export async function fetchGitObjects(arweave, remoteURI) {
  const query = {
    op: "and",
    expr1: repoQuery(remoteURI),
    expr2: {
      op: "and",
      expr1: { op: "equals", expr1: "oid", expr2: oid },
      expr2: { op: "equals", expr1: "Type", expr2: "push-git-object" },
    },
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

export async function pushPackfile(
  arweave,
  wallet,
  remoteURI,
  oldoid,
  oid,
  packfile
) {
  const { repoName } = parseArgitRemoteURI(remoteURI);

  let tx = await arweave.createTransaction({ data: packfile.packfile }, wallet);
  tx = addTransactionTags(tx, repoName, "send-pack");
  tx.addTag("oid", oid);
  tx.addTag("oldoid", oldoid);
  tx.addTag("filename", packfile.filename);

  await arweave.transactions.sign(tx, wallet);
  let uploader = await arweave.transactions.getUploader(tx);

  while (!uploader.isComplete) {
    await uploader.uploadChunk();
    console.log(
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

  await arweave.transactions.sign(pstTx, wallet);
  await arweave.transactions.post(pstTx);
}

export async function fetchPackfiles(arweave, remoteURI) {
  const query = {
    op: "and",
    expr1: repoQuery(remoteURI),
    expr2: { op: "equals", expr1: "Type", expr2: "send-pack" },
  };
  const txids = await arweave.arql(query);
  const packfiles = await Promise.all(
    txids.map(async (txid) => {
      const tx = await arweave.transactions.get(txid);
      let filename = "";
      tx.get("tags").forEach((tag) => {
        const key = tag.get("name", { decode: true, string: true });
        const value = tag.get("value", { decode: true, string: true });
        if (key === "filename") filename = value;
      });
      const data = await arweave.transactions.getData(txid, { decode: true });
      return { data, filename };
    })
  );
  return packfiles;
}

export async function getRefsOnArweave(arweave, remoteURI) {
  const refs = new Map();
  const query = {
    op: "and",
    expr1: repoQuery(remoteURI),
    expr2: { op: "equals", expr1: "Type", expr2: "update-ref" },
  };
  const txids = await arweave.arql(query);
  const tx_rows = await Promise.all(
    txids.map(async (txid) => {
      let ref = {};
      const tx = await arweave.transactions.get(txid);
      tx.get("tags").forEach((tag) => {
        const key = tag.get("name", { decode: true, string: true });
        const value = tag.get("value", { decode: true, string: true });
        if (key === "Unix-Time") ref.unixTime = value;
        else if (key === "ref") ref.name = value;
      });

      ref.oid = await arweave.transactions.getData(txid, {
        decode: true,
        string: true,
      });

      return ref;
    })
  );

  // descending order
  tx_rows.sort((a, b) => {
    Number(b.unixTime) - Number(a.unixTime);
  });

  tx_rows.forEach((ref) => {
    if (!refs.has(ref.name)) refs.set(ref.name, ref.oid);
  });

  return refs;
}
