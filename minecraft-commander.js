const path = require('path');
const fs = require('fs').promises;
const { getOS, checkRules, inheritJson } = require('./utils');

function getClasspathSeparator() {
    return getOS() === 'windows' ? ';' : ':';
}

function getLibraryPath(libName, minecraftPath) {
    const [groupId, artifactId, version] = libName.split(':');
    const groupPath = groupId.replace(/\./g, '/');
    const fileName = `${artifactId}-${version}.jar`;
    return path.join(minecraftPath, 'libraries', groupPath, artifactId, version, fileName);
}

function getLibrariesClasspath(versionData, minecraftPath) {
    const separator = getClasspathSeparator();
    let classpath = [];

    for (const lib of versionData.libraries) {
        if (!checkRules(lib.rules)) {
            continue;
        }

        if (lib.downloads && lib.downloads.artifact) {
            classpath.push(path.join(minecraftPath, 'libraries', lib.downloads.artifact.path));
        } else {
            // This case might be for very old versions, getLibraryPath should handle it
            classpath.push(getLibraryPath(lib.name, minecraftPath));
        }
    }
    // Add the client jar to the classpath
    classpath.push(path.join(minecraftPath, 'versions', versionData.id, `${versionData.id}.jar`));

    return classpath.join(separator);
}

function replaceArguments(argString, options, versionData, classpath, minecraftPath) {
    const replacements = {
        '${natives_directory}': options.nativesDir,
        '${launcher_name}': options.launcherName,
        '${launcher_version}': options.launcherVersion,
        '${classpath}': classpath,
        '${auth_player_name}': options.username,
        '${version_name}': versionData.id,
        '${game_directory}': options.gameDir,
        '${assets_root}': path.join(minecraftPath, 'assets'),
        '${assets_index_name}': versionData.assets,
        '${auth_uuid}': options.uuid,
        '${auth_access_token}': options.token,
        '${auth_session}': options.token,
        '${user_type}': 'msa',
        '${version_type}': versionData.type,
        '${user_properties}': '{}',
        '${resolution_width}': options.resolution.width,
        '${resolution_height}': options.resolution.height,
        '${library_directory}': path.join(minecraftPath, 'libraries'),
        '${classpath_separator}': getClasspathSeparator()
    };

    return Object.entries(replacements).reduce((acc, [key, value]) => {
        return acc.replace(new RegExp(key.replace(/[$}{]/g, '\\$&'), 'g'), value);
    }, argString);
}

function processArguments(args, options, versionData, classpath, minecraftPath) {
    const processedArgs = [];
    for (const arg of args) {
        if (typeof arg === 'string') {
            processedArgs.push(replaceArguments(arg, options, versionData, classpath, minecraftPath));
        } else if (arg.rules && checkRules(arg.rules)) {
            const value = Array.isArray(arg.value) ? arg.value : [arg.value];
            value.forEach(v => processedArgs.push(replaceArguments(v, options, versionData, classpath, minecraftPath)));
        }
    }
    return processedArgs;
}


async function getMinecraftCommand(versionId, minecraftPath, options) {
    const versionJsonPath = path.join(minecraftPath, 'versions', versionId, `${versionId}.json`);
    let versionData = JSON.parse(await fs.readFile(versionJsonPath, 'utf8'));

    if (versionData.inheritsFrom) {
        versionData = await inheritJson(versionData, minecraftPath);
    }

    // Prepare default options
    const defaultOptions = {
        username: 'Player',
        uuid: '00000000-0000-0000-0000-000000000000',
        token: '0',
        launcherName: 'node-minecraft-launcher',
        launcherVersion: '1.0',
        gameDir: minecraftPath,
        nativesDir: path.join(minecraftPath, 'versions', versionId, 'natives'),
        resolution: { width: '854', height: '480' },
        ...options
    };

    const classpath = getLibrariesClasspath(versionData, minecraftPath);
    const javaExecutable = 'java'; // For simplicity, assuming java is in PATH

    let command = [javaExecutable];

    // JVM Arguments
    if (versionData.arguments && versionData.arguments.jvm) {
        command.push(...processArguments(versionData.arguments.jvm, defaultOptions, versionData, classpath, minecraftPath));
    } else {
        command.push(`-Djava.library.path=${defaultOptions.nativesDir}`);
        command.push('-cp', classpath);
    }
    
    // Main Class
    command.push(versionData.mainClass);

    // Game Arguments
    if (versionData.arguments && versionData.arguments.game) {
        command.push(...processArguments(versionData.arguments.game, defaultOptions, versionData, classpath, minecraftPath));
    } else if (versionData.minecraftArguments) {
        // Legacy versions
        command.push(...replaceArguments(versionData.minecraftArguments, defaultOptions, versionData, classpath, minecraftPath).split(' '));
    }

    return command;
}

module.exports = { getMinecraftCommand }; 