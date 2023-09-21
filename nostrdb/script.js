const db = indexedDB.open("NostrDB", 1);

db.onupgradeneeded = function (event) {
  const db = event.target.result;
  const objectStore = db.createObjectStore("Backups");
};

db.onerror = function (event) {
  console.error("Database error:", event.target.error);
};

db.onsuccess = function (event) {
  const db = event.target.result;

  // Upload a file
  document
    .getElementById("upload-button")
    .addEventListener("click", function () {
      const file = document.getElementById("file-upload").files[0];
      const reader = new FileReader();

      reader.onload = function () {
        const fileData = reader.result;
        const transaction = db.transaction(["Backups"], "readwrite");
        const objectStore = transaction.objectStore("Backups");

        const request = objectStore.add(fileData, file.name);

        request.onsuccess = function () {
          console.log("File added successfully.");
        };

        request.onerror = function () {
          console.error("Error adding file:", request.error);
        };
      };

      reader.readAsArrayBuffer(file);
    });

  // Download a file
  document
    .getElementById("download-button")
    .addEventListener("click", function () {
      const transaction = db.transaction(["Backups"], "readonly");
      const objectStore = transaction.objectStore("Backups");
      const request = objectStore.getAllKeys();

      request.onsuccess = function () {
        const files = request.result;

        for (const file of files) {
          const getRequest = objectStore.get(file);

          getRequest.onsuccess = function () {
            const data = getRequest.result;

            // Create a blob object from the file data
            const blob = new Blob([data], { type: "application/octet-stream" });

            // Create a URL object from the blob object
            const url = URL.createObjectURL(blob);

            // Create an anchor element
            const a = document.createElement("a");

            // Set the href and download attributes of the anchor element
            a.href = url;
            a.download = file;

            // Click the anchor element to download the file
            a.click();

            // Revoke the object URL
            URL.revokeObjectURL(url);
          };
        }
      };

      request.onerror = function () {
        console.error("Error getting file names:", request.error);
      };
    });
};


// displayStoredFiles.js

// Open the IndexedDB database
const dbName = 'NostrDB';
const objectStoreName = 'Backups';

// displayStoredFiles.js


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

const displayFiles = async () => {
    try {
        const db = await openDatabase();
        const transaction = db.transaction([objectStoreName], 'readonly');
        const objectStore = transaction.objectStore(objectStoreName);

        const fileList = document.getElementById('fileList');

        // Clear the existing list
        fileList.innerHTML = '';

        // Retrieve all stored files
        objectStore.openCursor().onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                // Create list items for each file
                const li = document.createElement('li');

                // Create a download button for each file
                const downloadButton = document.createElement('button');
                downloadButton.textContent = 'Download';
                downloadButton.addEventListener('click', () => {
                    downloadFile(cursor.key); // Trigger download when the button is clicked
                });

                // Display the file key (unique name)
                li.textContent = cursor.key;

                // Append the download button to the list item
                li.appendChild(downloadButton);

                // Append the list item to the file list
                fileList.appendChild(li);

                cursor.continue();
            }
        };
    } catch (error) {
        console.error('Error opening IndexedDB:', error);
    }
};

const downloadFile = async (fileName) => {
    try {
        const db = await openDatabase();
        const transaction = db.transaction([objectStoreName], 'readonly');
        const objectStore = transaction.objectStore(objectStoreName);

        // Retrieve the file by its unique key
        const request = objectStore.get(fileName);

        request.onsuccess = (event) => {
            const fileData = event.target.result;

            if (fileData) {
                // Create a blob URL for the file
                const blob = new Blob([fileData], { type: 'text/javascript' });
                const url = window.URL.createObjectURL(blob);

                // Create an anchor element for downloading
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = fileName;

                // Trigger a click event to start the download
                downloadLink.click();

                // Revoke the blob URL
                window.URL.revokeObjectURL(url);
            } else {
                console.error('File not found:', fileName);
            }
        };
    } catch (error) {
        console.error('Error opening IndexedDB:', error);
    }
};

// Call the displayFiles function when the page loads
window.onload = displayFiles;
