const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { getOS, checkRules, inheritJson } = require('./utils');

const LAUNCHER_META_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_URL = 'https://resources.download.minecraft.net';
const LIBRARIES_URL = 'https://libraries.minecraft.net';

async function downloadFile(url, filePath, sha1, progressCallback) {
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        if (await fileExistsAndIsValid(filePath, sha1)) {
            if (progressCallback) {
                progressCallback({ status: `Skipping existing file: ${path.basename(filePath)}` });
            }
            return;
        }

        if (progressCallback) {
            progressCallback({ status: `Downloading: ${path.basename(filePath)}` });
        }

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        await fs.writeFile(filePath, response.data);

        if (!await fileExistsAndIsValid(filePath, sha1)) {
            throw new Error(`SHA1 mismatch for ${path.basename(filePath)}`);
        }
    } catch (error) {
        console.error(`Failed to download ${url}. Error: ${error.message}`);
        throw error;
    }
}

async function fileExistsAndIsValid(filePath, expectedSha1) {
    try {
        const buffer = await fs.readFile(filePath);
        if (expectedSha1) {
            const hash = crypto.createHash('sha1').update(buffer).digest('hex');
            return hash === expectedSha1;
        }
        return true; // File exists, no sha1 to check
    } catch (error) {
        return false; // File does not exist or other reading error
    }
}

async function installLibraries(versionData, minecraftPath, progressCallback) {
    const libraries = versionData.libraries;
    const libraryPath = path.join(minecraftPath, 'libraries');
    
    const librariesToDownload = libraries.filter(lib => checkRules(lib.rules));
    const totalLibraries = librariesToDownload.length;
    let downloadedCount = 0;

    progressCallback({ status: 'Downloading libraries...', max: totalLibraries });

    // Chunk downloads to avoid "socket hang up" errors
    const concurrencyLimit = 10;
    for (let i = 0; i < librariesToDownload.length; i += concurrencyLimit) {
        const chunk = librariesToDownload.slice(i, i + concurrencyLimit);
        await Promise.all(chunk.map(async (lib) => {
            let artifactUrl, artifactPath;

            if (lib.downloads && lib.downloads.artifact) {
                const artifact = lib.downloads.artifact;
                artifactUrl = artifact.url;
                artifactPath = path.join(libraryPath, artifact.path);
            } else {
                const [groupId, artifactId, version] = lib.name.split(':');
                const groupPath = groupId.replace(/\./g, '/');
                const fileName = `${artifactId}-${version}.jar`;
                artifactPath = path.join(libraryPath, groupPath, artifactId, version, fileName);
                artifactUrl = `${LIBRARIES_URL}/${groupPath}/${artifactId}/${version}/${fileName}`;
            }
            
            await downloadFile(artifactUrl, artifactPath, lib.downloads?.artifact?.sha1, null);

            // Handle natives
            const os = getOS();
            if (lib.natives && lib.natives[os]) {
                const nativeClassifier = lib.natives[os];
                if (lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[nativeClassifier]) {
                    const nativeInfo = lib.downloads.classifiers[nativeClassifier];
                    const nativePath = path.join(libraryPath, nativeInfo.path);
                    await downloadFile(nativeInfo.url, nativePath, nativeInfo.sha1, null);
                    
                    const nativesDir = path.join(minecraftPath, 'versions', versionData.id, 'natives');
                    await fs.mkdir(nativesDir, { recursive: true });

                    try {
                        const zip = new AdmZip(nativePath);
                        // TODO: Implement extraction rules if needed ('extract' property in library)
                        zip.extractAllTo(nativesDir, true);
                    } catch (e) {
                        console.warn(`Could not extract natives from ${nativePath}: ${e.message}`);
                    }
                }
            }

            downloadedCount++;
            progressCallback({ progress: downloadedCount });
        }));
    }
}


async function installAssets(versionData, minecraftPath, progressCallback) {
    if (!versionData.assetIndex) return;

    const assetIndexPath = path.join(minecraftPath, 'assets', 'indexes', `${versionData.assets}.json`);
    await downloadFile(versionData.assetIndex.url, assetIndexPath, versionData.assetIndex.sha1, progressCallback);

    const assetIndex = JSON.parse(await fs.readFile(assetIndexPath, 'utf8'));
    const objects = assetIndex.objects;
    const objectEntries = Object.entries(objects);
    let downloadedCount = 0;

    progressCallback({ status: 'Downloading assets...', max: objectEntries.length });

    // Chunk downloads to avoid "socket hang up" errors
    const concurrencyLimit = 10;
    for (let i = 0; i < objectEntries.length; i += concurrencyLimit) {
        const chunk = objectEntries.slice(i, i + concurrencyLimit);
        const downloadPromises = chunk.map(async ([key, value]) => {
            const hash = value.hash;
            const subPath = hash.substring(0, 2);
            const assetDir = path.join(minecraftPath, 'assets', 'objects', subPath);
            const assetPath = path.join(assetDir, hash);
            const url = `${RESOURCES_URL}/${subPath}/${hash}`;

            await downloadFile(url, assetPath, hash, null);

            downloadedCount++;
            progressCallback({ progress: downloadedCount });
        });
        await Promise.all(downloadPromises);
    }
}

async function installMinecraftVersion(versionId, minecraftPath, progressCallback) {
    // 1. Get version manifest
    progressCallback({ status: `Fetching version manifest...` });
    const manifestResponse = await axios.get(LAUNCHER_META_URL);
    const manifest = manifestResponse.data;

    const versionInfo = manifest.versions.find(v => v.id === versionId);
    if (!versionInfo) {
        throw new Error(`Version ${versionId} not found.`);
    }

    // 2. Download version.json
    progressCallback({ status: `Downloading ${versionId}.json...` });
    const versionPath = path.join(minecraftPath, 'versions', versionId);
    const versionJsonPath = path.join(versionPath, `${versionId}.json`);
    await downloadFile(versionInfo.url, versionJsonPath, versionInfo.sha1, progressCallback);
    let versionData = JSON.parse(await fs.readFile(versionJsonPath, 'utf8'));

    // 3. Handle inheritance (for mods like Forge)
    if (versionData.inheritsFrom) {
        progressCallback({ status: `Handling inheritance from ${versionData.inheritsFrom}` });
        // Ensure parent is installed
        const parentVersionJsonPath = path.join(minecraftPath, 'versions', versionData.inheritsFrom, `${versionData.inheritsFrom}.json`);
        try {
            await fs.access(parentVersionJsonPath);
        } catch (e) {
            // If not, install it.
            await installMinecraftVersion(versionData.inheritsFrom, minecraftPath, (e) => {}); // Using a dummy progress callback
        }
        versionData = await inheritJson(versionData, minecraftPath);
    }
    
    // 4. Install libraries
    await installLibraries(versionData, minecraftPath, progressCallback);

    // 5. Install assets
    await installAssets(versionData, minecraftPath, progressCallback);

    // 6. Download client.jar
    if (versionData.downloads && versionData.downloads.client) {
        progressCallback({ status: 'Downloading client.jar...' });
        const clientUrl = versionData.downloads.client.url;
        const clientSha1 = versionData.downloads.client.sha1;
        const clientPath = path.join(versionPath, `${versionId}.jar`);
        await downloadFile(clientUrl, clientPath, clientSha1, progressCallback);
    }
    
    progressCallback({ status: 'Installation finished.' });
}

module.exports = { installMinecraftVersion }; 