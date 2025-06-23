document.getElementById('download-form').addEventListener('submit', function(event) {
    event.preventDefault();
    
    const version = document.getElementById('version').value;
    if (!version) {
        alert('Please enter a Minecraft version.');
        return;
    }

    const progressContainer = document.getElementById('progress-container');
    const statusDiv = document.getElementById('status');
    const progressBarInner = document.getElementById('progress-bar-inner');
    const launchContainer = document.getElementById('launch-container');
    const launchButton = document.getElementById('launch-button');
    const launchCommandText = document.getElementById('launch-command');
    
    progressContainer.style.display = 'block';
    launchContainer.style.display = 'none';
    statusDiv.textContent = 'Starting download...';
    progressBarInner.style.width = '0%';
    progressBarInner.textContent = '0%';

    let eventSource;
    try {
        eventSource = new EventSource(`/install?version=${version}`);
    } catch (e) {
        statusDiv.textContent = `Error connecting to server. Make sure the server is running. ${e.message}`;
        return;
    }


    let currentProgress = 0;
    let maxProgress = 0;

    eventSource.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.status) {
            statusDiv.textContent = data.status;
        }

        if (data.max) {
            currentProgress = 0;
            maxProgress = data.max;
        }

        if (data.progress) {
            currentProgress = data.progress;
        }

        if(maxProgress > 0) {
            const percentage = Math.round((currentProgress / maxProgress) * 100);
            progressBarInner.style.width = `${percentage}%`;
            progressBarInner.textContent = `${percentage}%`;
        }
        
        if (data.error) {
            statusDiv.textContent = `Error: ${data.status}`;
            eventSource.close();
        }

        if (data.status === 'Installation finished.' || data.status === 'Installation complete!') {
            progressBarInner.style.width = `100%`;
            progressBarInner.textContent = `100%`;
            launchContainer.style.display = 'block';
            eventSource.close();
        }
    };

    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        statusDiv.textContent = 'Connection to server lost. Please try again.';
        eventSource.close();
    };

    launchButton.addEventListener('click', async () => {
        launchCommandText.value = 'Generating command...';
        try {
            const response = await fetch(`/launch?version=${version}`);
            const command = await response.json();
            if (response.ok) {
                // Quote arguments with spaces to make it copy-paste friendly
                const commandString = command.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ');
                launchCommandText.value = commandString;
            } else {
                launchCommandText.value = `Error: ${command.error}`;
            }
        } catch (error) {
            launchCommandText.value = `Failed to fetch launch command: ${error.message}`;
        }
    });
}); 