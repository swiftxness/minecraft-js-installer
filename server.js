const express = require('express');
const path = require('path');
const { installMinecraftVersion } = require('./minecraft-installer');
const { getMinecraftCommand } = require('./minecraft-commander');

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/install', async (req, res) => {
    const versionId = req.query.version;

    if (!versionId) {
        return res.status(400).send('Minecraft version is required.');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const minecraftPath = path.join(__dirname, 'minecraft');
        await installMinecraftVersion(versionId, minecraftPath, sendProgress);
        sendProgress({ status: 'Installation complete!', progress: 100, file: 'Done' });
    } catch (error) {
        console.error('Installation failed:', error);
        sendProgress({ status: `Error: ${error.message}`, error: true });
    } finally {
        res.end();
    }
});

app.get('/launch', async (req, res) => {
    const versionId = req.query.version;
    if (!versionId) {
        return res.status(400).send('Minecraft version is required.');
    }

    try {
        const minecraftPath = path.join(__dirname, 'minecraft');
        const command = await getMinecraftCommand(versionId, minecraftPath, {});
        res.json(command);
    } catch (error) {
        console.error('Failed to get launch command:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 