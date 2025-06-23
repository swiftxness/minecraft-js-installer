const fs = require('fs').promises;
const path = require('path');

function getOS() {
    switch (process.platform) {
        case 'win32': return 'windows';
        case 'darwin': return 'osx';
        case 'linux': return 'linux';
        default: return 'unknown';
    }
}

function checkRules(rules) {
    if (!rules) return true;

    let allow = false;
    const osName = getOS();

    for (const rule of rules) {
        const { action, os, features } = rule;
        let applies = true;

        if (os) {
            if (os.name && os.name !== osName) {
                applies = false;
            }
            // Ignoring os.version for simplicity
        }

        // This is a rudimentary check for features.
        // A real implementation would need to know the enabled features from options.
        if (features && features.is_demo_user) {
             // for now, we assume we are not a demo user
            applies = false;
        }


        if (applies) {
            allow = (action === 'allow');
        }
    }
    return allow;
}

async function inheritJson(versionData, minecraftPath) {
    const parentId = versionData.inheritsFrom;
    const parentPath = path.join(minecraftPath, 'versions', parentId, `${parentId}.json`);
    const parentData = JSON.parse(await fs.readFile(parentPath, 'utf8'));

    // This is a simplified merge. A more complete implementation would merge lists.
    const merged = { ...parentData, ...versionData };
    merged.libraries = [
        ...parentData.libraries,
        ...versionData.libraries,
    ];
    if (parentData.arguments && versionData.arguments) {
        merged.arguments = {
            game: [...(parentData.arguments.game || []), ...(versionData.arguments.game || [])],
            jvm: [...(parentData.arguments.jvm || []), ...(versionData.arguments.jvm || [])],
        };
    }

    return merged;
}

module.exports = { getOS, checkRules, inheritJson }; 