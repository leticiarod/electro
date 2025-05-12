window.addEventListener('DOMContentLoaded', () => {
  const steps = [
    {
      id: 0,
      action: async () => {
        setStatus(0, 'Please select your local agent folder.');
        const folder = await window.electronAPI.selectAgentFolder();
        if (folder) {
          // Validate folder: must contain package.json, src/index.js, and pairing-code.txt
          const hasPkg = await window.electronAPI.fileExists(folder + '/package.json');
          const hasIndex = await window.electronAPI.fileExists(folder + '/src/index.js');
          const hasPairing = await window.electronAPI.fileExists(folder + '/pairing-code.txt');
          document.getElementById('agent-folder-path').value = folder;
          if (!hasPkg || !hasIndex) {
            setStatus(0, 'Selected folder is not a valid agent folder!');
            return false;
          }
          if (!hasPairing) {
            setStatus(0, 'Selected folder does not contain pairing-code.txt!');
            return false;
          }
          setStatus(0, 'Agent folder selected: ' + folder);
          return true;
        } else {
          setStatus(0, 'No agent folder selected!');
          return false;
        }
      }
    },
    {
      id: 1,
      action: async () => {
        setStatus(1, 'Checking/installing dependencies...');
        document.getElementById('install-deps').disabled = true;
        document.getElementById('dep-spinner').style.display = '';
        const result = await window.electronAPI.checkInstallDeps();
        setStatus(1, result.summary + (result.details && result.details.trim() ? '\n' : ''));
        document.getElementById('dep-spinner').style.display = 'none';
        // if dependencies are not installed, re-enable the install deps button
        if (!result.summary.includes('installed')) {
          document.getElementById('install-deps').disabled = false;
        }
        if (result.details && result.details.trim()) {
          let detailsBlock = document.getElementById('dep-details');
          if (!detailsBlock) {
            detailsBlock = document.createElement('pre');
            detailsBlock.id = 'dep-details';
            detailsBlock.style.color = '#888';
            detailsBlock.style.fontSize = '0.95em';
            document.getElementById('status-1').appendChild(detailsBlock);
          }
          detailsBlock.innerText = result.details;
        } else {
          const detailsBlock = document.getElementById('dep-details');
          if (detailsBlock) detailsBlock.remove();
        }
        return result.summary.includes('installed');
      }
    },
    {
      id: 2,
      action: async () => {
        setStatus(2, '');
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
          document.getElementById('folder-path').value = folder;
          setStatus(2, 'Folder selected.');
          return true;
        } else {
          setStatus(2, 'Select a folder first!');
          return false;
        }
      }
    },
    {
      id: 3,
      action: async () => {
        const folder = document.getElementById('folder-path').value;
        if (!folder || folder === 'No folder selected') {
          setStatus(3, 'Select a folder first!');
          return false;
        }
        const result = await window.electronAPI.writeEnv(folder);
        if (result.success) {
          setStatus(3, '.env updated!');
          return true;
        } else {
          setStatus(3, 'Failed to update .env: ' + (result.error || 'Unknown error'));
          return false;
        }
      }
    },
    {
      id: 4,
      action: async () => {
        setStatus(4, 'Starting local agent...');
        await window.electronAPI.runAgent();
        setStatus(4, 'Local agent started!');
        return true;
      }
    },
    {
      id: 5,
      action: async () => {
        let debugMsg = '';
        let code = '';
        let pathStr = '';
        try {
          code = await window.electronAPI.readPairingCode();
          pathStr = await window.electronAPI.getPairingCodePath();
          const exists = !!code;
          debugMsg = `Path: ${pathStr}\nExists: ${exists ? 'Yes' : 'No'}`;
        } catch (err) {
          debugMsg = `Error reading pairing code: ${err?.message || err}`;
        }
        document.getElementById('pairing-code').value = code;
        const pairingCodePathElem = document.getElementById('pairing-code-path');
        if (pairingCodePathElem) {
          pairingCodePathElem.textContent = debugMsg;
        }
        if (code) {
          setStatus(5, 'Pairing code received!');
          return true;
        } else {
          setStatus(5, 'No pairing code found!');
          return false;
        }
      }
    }
  ];

  let currentStep = 0;
  const totalSteps = steps.length;
  let pairingCodePoller = null;

  function setStatus(step, msg) {
    document.getElementById(`status-${step}`).innerText = msg;
  }

  function showStep(idx) {
    for (let i = 0; i < totalSteps; i++) {
      document.getElementById(`carousel-${i}`).classList.remove('active');
      document.getElementById(`step-${i}`).classList.remove('active', 'done');
      if (i < idx) document.getElementById(`step-${i}`).classList.add('done');
    }
    document.getElementById(`carousel-${idx}`).classList.add('active');
    document.getElementById(`step-${idx}`).classList.add('active');
    document.getElementById('prev-step').style.display = idx === 0 ? 'none' : '';
    document.getElementById('next-step').innerText = idx === totalSteps - 1 ? 'Finish' : 'Next';

    // Start/stop pairing code polling for step 6
    if (pairingCodePoller) {
      clearInterval(pairingCodePoller);
      pairingCodePoller = null;
    }
    if (idx === 5) {
      const pollPairingCode = async () => {
        let debugMsg = '';
        let code = '';
        let pathStr = '';
        try {
          code = await window.electronAPI.readPairingCode();
          pathStr = await window.electronAPI.getPairingCodePath();
          const exists = !!code;
          debugMsg = `Path: ${pathStr}\nExists: ${exists ? 'Yes' : 'No'}`;
        } catch (err) {
          debugMsg = `Error reading pairing code: ${err?.message || err}`;
        }
        document.getElementById('pairing-code').value = code;
        const pairingCodePathElem = document.getElementById('pairing-code-path');
        if (pairingCodePathElem) {
          pairingCodePathElem.textContent = debugMsg;
        }
        if (code) {
          setStatus(5, 'Pairing code received!');
        } else {
          setStatus(5, 'No pairing code found!');
        }
      };
      pollPairingCode();
      pairingCodePoller = setInterval(pollPairingCode, 2000);
    }
  }

  async function handleStepAction() {
    const ok = await steps[currentStep].action();
    document.getElementById('next-step').disabled = !ok;
  }

  // Attach step button handlers
  document.getElementById('select-agent-folder').onclick = () => handleStepAction();
  document.getElementById('install-deps').onclick = () => handleStepAction();
  document.getElementById('select-folder').onclick = () => handleStepAction();
  document.getElementById('write-env').onclick = () => handleStepAction();
  document.getElementById('run-agent').onclick = () => handleStepAction();
  document.getElementById('copy-code').onclick = async () => {
    const code = await window.electronAPI.readPairingCode();
    document.getElementById('pairing-code').value = code;
    if (code) {
      const ok = await window.electronAPI.copyToClipboard();
      setStatus(5, ok ? 'Copied to clipboard!' : 'Failed to copy!');
    } else {
      setStatus(5, 'No pairing code found to copy!');
    }
  };

  document.getElementById('next-step').onclick = async () => {
    if (currentStep < totalSteps - 1) {
      currentStep++;
      showStep(currentStep);
      document.getElementById('next-step').disabled = true;
    } else {
      setStatus(5, 'Setup complete!');
    }
  };
  document.getElementById('prev-step').onclick = () => {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep);
      document.getElementById('next-step').disabled = true;
    }
  };

  // Initial state
  showStep(0);
  document.getElementById('next-step').disabled = true;

  // Listen for 'dep-status' IPC messages from the main process
  window.electronAPI && window.electronAPI.receiveDepStatus && window.electronAPI.receiveDepStatus((event, { dep, status, message }) => {});

  // Add a map to track dependency statuses
  const depStatusMap = {};

  // Listen for dep-status events from main process
  if (window.electronAPI && window.electronAPI.receiveDepStatus) {
    window.electronAPI.receiveDepStatus((event, { dep, status, message }) => {
      depStatusMap[dep] = { status, message };
      // Update the UI (step 1 or 2 status area)
      const statusDiv = document.getElementById('dep-progress');
      if (statusDiv) {
        statusDiv.innerHTML = Object.entries(depStatusMap).map(([d, s]) => `<div><b>${d}</b>: ${s.message}</div>`).join('');
      }
    });
  }
}); 