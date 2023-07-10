const chokidar = require("chokidar");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

async function promisifiedReadFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

async function loadSavedCredentialsIfExist() {
  try {
    const content = await promisifiedReadFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await promisifiedReadFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: keys.client_id,
    client_secret: keys.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await promisifiedWriteFile(TOKEN_PATH, payload);
}

function promisifiedWriteFile(filePath, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(filePath, data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await google.auth.getClient({
    keyFilename: CREDENTIALS_PATH,
    scopes: SCOPES,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

const ROOT_FOLDER_ID = "[<Your Google Drive folder ID>]";

async function uploadFile(authClient, filePath) {
  try {
    const drive = google.drive({ version: "v3", auth: authClient });

    const fileStats = await promisifiedStat(filePath);
    const creationTime = fileStats.birthtime; // Retrieve the file's creation time

    const year = creationTime.getFullYear().toString();
    const month = (creationTime.getMonth() + 1).toString().padStart(2, "0");

    const folderName = `${year}_${month}`;

    // Create or find the year folder
    const yearFolder = await findOrCreateFolder(drive, ROOT_FOLDER_ID, year);

    // Create or find the month folder within the year folder
    const monthFolder = await findOrCreateFolder(drive, yearFolder.id, month);

    const formattedCreationTime = creationTime.toISOString().slice(0, 10);

    const fileMetadata = {
      name: formattedCreationTime + path.extname(filePath),
      parents: [monthFolder.id],
    };

    const media = {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(filePath),
    };

    const response = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });

    console.log("File uploaded. File ID:", response.data.id);
    console.log("Year folder:", yearFolder.name);
    console.log("Month folder:", monthFolder.name);
  } catch (error) {
    console.error("Error occurred while uploading the file:", error);
  }
}

async function findOrCreateFolder(drive, parentFolderId, folderName) {
  const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents`;
  const response = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (response.data.files.length > 0) {
    // Folder already exists, return the first matching folder
    return response.data.files[0];
  } else {
    // Folder does not exist, create a new folder
    const folderMetadata = {
      name: folderName,
      parents: [parentFolderId],
      mimeType: "application/vnd.google-apps.folder",
    };

    const newFolder = await drive.files.create({
      resource: folderMetadata,
      fields: "id, name",
    });

    return newFolder.data;
  }
}

async function promisifiedStat(filePath) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        reject(err);
      } else {
        resolve(stats);
      }
    });
  });
}


authorize()
  .then((authClient) => {
    console.log("Receive folder is being watched");

    const receiveFolder =  "[<Directory path that will be watched>]";

    const watcher = chokidar.watch(receiveFolder, {
      persistent: true,
      awaitWriteFinish: true,
      ignoreInitial: true,
    });

    watcher.on("add", async (filePath) => {
      const fileName = path.basename(filePath);
      if(fileName.includes("[<Key words>]")) {
        uploadFile(authClient, filePath);
      }
    });

    watcher.on("error", (error) => {
      console.error("Error happened", error);
    });
  })
  .catch(console.error);
