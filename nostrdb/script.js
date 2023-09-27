// Open the IndexedDB database
const dbName = 'NostrDB';
const objectStoreName = 'Backups';

const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = (event) => {
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      resolve(db);
    };
  });
};

const formatSize = (sizeInBytes) => {
  const sizeInMB = sizeInBytes / (1024 * 1024); // Convert bytes to megabytes
  return sizeInMB.toFixed(2); // Format to two decimal places
};

// displayStoredFiles.js

// ...

const displayFiles = async () => {
  try {
    const db = await openDatabase();
    const transaction = db.transaction(["Backups"], "readonly");
    const objectStore = transaction.objectStore("Backups");

    const fileList = document.getElementById("fileList");

    // Clear the existing table rows
    fileList.innerHTML = "";

    // Retrieve all stored files
    objectStore.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        // Create a table row for each file
        const tr = document.createElement("tr");

        // File Name column
        const fileNameTd = document.createElement("td");
        fileNameTd.textContent = "Backup"; 
        tr.appendChild(fileNameTd);

        // Metadata columns (Date, Time, Size)
        const dateTd = document.createElement("td");
        dateTd.textContent = cursor.value.date || "N/A";
        tr.appendChild(dateTd);

        const timeTd = document.createElement("td");
        timeTd.textContent = cursor.value.time || "N/A";
        tr.appendChild(timeTd);

        const sizeTd = document.createElement("td");
        sizeTd.textContent = cursor.value.size
          ? formatSize(cursor.value.size)
          : "N/A";
        tr.appendChild(sizeTd);

        // Actions column (Download button)
        const actionsTd = document.createElement("td");
        const downloadButton = document.createElement("button");
        downloadButton.textContent = "Download";
        downloadButton.addEventListener("click", () => {
          downloadFile(cursor.key); // Trigger download when the button is clicked
        });
        actionsTd.appendChild(downloadButton);
        tr.appendChild(actionsTd);

        // Append the table row to the file list
        fileList.appendChild(tr);

        cursor.continue();
      }
    };
  } catch (error) {
    console.error("Error opening IndexedDB:", error);
  }
};




const downloadFile = async (fileName) => {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([objectStoreName], "readonly");
    const objectStore = transaction.objectStore(objectStoreName);

    // Retrieve the file by its unique key (fileName)
    const request = objectStore.get(fileName);

    request.onsuccess = (event) => {
      const fileData = event.target.result;

      if (fileData) {
        // Create a blob URL for the file
        const blob = new Blob([fileData.content], { type: "text/javascript" });
        const url = window.URL.createObjectURL(blob);

        // Create an anchor element for downloading
        const downloadLink = document.createElement("a");
        downloadLink.href = url;
        downloadLink.download = fileName;

        // Trigger a click event to start the download
        downloadLink.click();

        // Revoke the blob URL
        window.URL.revokeObjectURL(url);
      } else {
        console.error("File not found:", fileName);
      }
    };
  } catch (error) {
    console.error("Error opening IndexedDB:", error);
  }
};

// ...

// Call the displayFiles function when the page loads
window.onload = displayFiles;
