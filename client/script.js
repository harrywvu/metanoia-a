const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_DURATION = 30;
const STATUS_FADE_MS = 150;

const uploadForm = document.getElementById('uploadForm');
const videoInput = document.getElementById('videoInput');
const genderSelect = document.getElementById('genderSelect');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const videoPreview = document.getElementById('videoPreview');
const loadingSection = document.getElementById('loadingSection');
const statusText = document.getElementById('statusText');
const resultSection = document.getElementById('resultSection');
const viewerCanvas = document.getElementById('viewer');
const downloadButton = document.getElementById('downloadButton');
const resetButton = document.getElementById('resetButton');
const uploadSection = document.getElementById('upload');
const loadingStage = document.getElementById('loading');
const resultStage = document.getElementById('result');
const fileInputLabel = document.getElementById('fileInputLabel');
const resultJobId = document.getElementById('resultJobId');
const resultGender = document.getElementById('resultGender');
const resultCreatedAt = document.getElementById('resultCreatedAt');
const heroSection = document.getElementById('hero');
const submitButton = uploadForm ? uploadForm.querySelector('.button-submit') : null;
const dropzoneShell = document.querySelector('.dropzone-shell');
const dropzoneBadge = dropzoneShell ? dropzoneShell.querySelector('.dropzone-badge') : null;
const footer = document.querySelector('.site-footer');
const genderButtons = document.querySelectorAll('[data-gender-value]');
const formatButtons = document.querySelectorAll('[data-format-value]');
const formatDescription = document.getElementById('formatDescription');
const copyJobIdButton = document.getElementById('copyJobIdButton');
const viewerHint = document.getElementById('viewerHint');
const pipelineSteps = document.querySelectorAll('.pipeline-step');
const navLinks = Array.from(document.querySelectorAll('.site-nav a[data-scroll-target]'));
const progressSteps = Array.from(document.querySelectorAll('.progress-step'));

let jobPollIntervalId = null;
let activeViewer = null;
let currentJobId = null;
let completedJob = null;
let statusTextTimerId = null;
let viewerHintTimerId = null;
let resetGuardTimerId = null;
let lastKnownProgressStep = 1;
let activeDownloadFormat = 'fbx';

const FORMAT_DESCRIPTIONS = {
    fbx: 'FBX - Autodesk format, compatible with Maya, 3ds Max, Unreal Engine',
    gltf: 'glTF - Web-native format, compatible with Three.js, Babylon.js, Unity'
};
const PROGRESS_STATUS_MAP = {
    pending: 1,
    downloading: 1,
    processing: 2,
    running: 2,
    running_vibe: 2,
    estimating: 2,
    exporting: 3,
    uploading_result: 3,
    done: 4
};

initMotionLayer();

if (videoInput) {
    videoInput.addEventListener('change', handleVideoChange);
    videoInput.addEventListener('change', () => {
        const file = videoInput.files && videoInput.files[0] ? videoInput.files[0] : null;
        updateSelectedFileUI(file);
    });
}

if (uploadForm) {
    uploadForm.addEventListener('submit', handleFormSubmit);
}

if (downloadButton) {
    downloadButton.addEventListener('click', handleDownload);
}

if (resetButton) {
    resetButton.addEventListener('click', handleResetClick);
}

if (copyJobIdButton) {
    copyJobIdButton.addEventListener('click', copyJobIdToClipboard);
}

genderButtons.forEach((button) => {
    button.addEventListener('click', () => {
        setGenderValue(button.dataset.genderValue || '');
    });
});

formatButtons.forEach((button) => {
    button.addEventListener('click', () => {
        setDownloadFormat(button.dataset.formatValue || 'fbx');
    });
});

pipelineSteps.forEach((step) => {
    step.addEventListener('click', () => {
        const isExpanded = step.classList.contains('is-expanded');
        pipelineSteps.forEach((item) => item.classList.remove('is-expanded'));
        if (!isExpanded) {
            step.classList.add('is-expanded');
        }
    });
});

if (viewerCanvas) {
    viewerCanvas.addEventListener('mousedown', hideViewerHint);
}

document.querySelectorAll('[data-scroll-target]').forEach((element) => {
    element.addEventListener('click', (event) => {
        const targetId = element.getAttribute('data-scroll-target');
        if (!targetId) {
            return;
        }

        event.preventDefault();
        smoothTo(targetId);
    });
});

function initMotionLayer() {
    if (heroSection) {
        heroSection.classList.add('is-visible');
    }

    [loadingStage, resultStage].forEach((section) => {
        if (!section) {
            return;
        }

        section.classList.remove('hidden');
        section.classList.remove('is-visible');
        section.style.display = 'none';
    });

    injectTerminalCursor();
    injectLoadingEllipsis();
    decorateAboutCards();
    decorateFooterNames();
    setupDropzoneInteractions();
    setupSectionObserver();
    setGenderValue('');
    setDownloadFormat(activeDownloadFormat);
    updateDownloadButtonState();
    updateProgressStepper(1, false);

    if (viewerCanvas) {
        viewerCanvas.classList.remove('model-loaded');
    }
}

function setupSectionObserver() {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('section').forEach((section) => {
            section.classList.add('is-visible');
        });
        syncNavState('hero');
        if (footer) {
            footer.classList.add('is-visible');
        }
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) {
                return;
            }

            entry.target.classList.add('is-visible');
            syncNavState(entry.target.id);
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('section').forEach((section) => {
        if (section.id === 'hero' || section === loadingStage || section === resultStage) {
            return;
        }
        observer.observe(section);
    });

    if (footer) {
        observer.observe(footer);
    }

    if ('IntersectionObserver' in window) {
        const scrollSpyObserver = new IntersectionObserver((entries) => {
            const visibleEntries = entries
                .filter((entry) => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

            if (!visibleEntries.length) {
                return;
            }

            syncNavState(visibleEntries[0].target.id);
        }, { threshold: [0.4, 0.6, 0.8] });

        document.querySelectorAll('section[id]').forEach((section) => {
            scrollSpyObserver.observe(section);
        });
    }
}

function setupDropzoneInteractions() {
    if (!dropzoneShell || !videoInput) {
        return;
    }

    const stopDragDefaults = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    dropzoneShell.addEventListener('dragover', (event) => {
        stopDragDefaults(event);
        dropzoneShell.classList.add('drag-active');
    });

    dropzoneShell.addEventListener('dragleave', (event) => {
        stopDragDefaults(event);
        if (event.relatedTarget && dropzoneShell.contains(event.relatedTarget)) {
            return;
        }
        dropzoneShell.classList.remove('drag-active');
    });

    dropzoneShell.addEventListener('drop', (event) => {
        stopDragDefaults(event);
        dropzoneShell.classList.remove('drag-active');

        const files = event.dataTransfer && event.dataTransfer.files;
        if (!files || !files.length) {
            return;
        }

        const transfer = new DataTransfer();
        Array.from(files).forEach((file) => transfer.items.add(file));
        videoInput.files = transfer.files;
        videoInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function decorateAboutCards() {
    document.querySelectorAll('.lottie-card').forEach((card, index) => {
        card.classList.add(`stagger-${index + 1}`);
    });
}

function decorateFooterNames() {
    document.querySelectorAll('.site-footer p').forEach((name, index) => {
        name.classList.add('footer-name', `footer-stagger-${index + 1}`);
    });
}

function injectTerminalCursor() {
    const terminalLines = document.querySelectorAll('#hero .terminal-line');
    const lastLine = terminalLines[terminalLines.length - 1];
    if (!lastLine || lastLine.querySelector('.terminal-cursor')) {
        return;
    }

    const cursor = document.createElement('span');
    cursor.className = 'terminal-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.textContent = '|';
    lastLine.appendChild(document.createTextNode(' '));
    lastLine.appendChild(cursor);
}

function injectLoadingEllipsis() {
    const loadingHeading = document.querySelector('#loadingSection h2');
    if (!loadingHeading || loadingHeading.querySelector('.ellipsis')) {
        return;
    }

    const ellipsis = document.createElement('span');
    ellipsis.className = 'ellipsis';
    ellipsis.setAttribute('aria-hidden', 'true');
    loadingHeading.appendChild(ellipsis);
}

function smoothTo(id) {
    const element = document.getElementById(id);
    if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
    }
}

function setSubmitLoading(isLoading) {
    if (!submitButton) {
        return;
    }

    submitButton.classList.toggle('btn-loading', isLoading);
    submitButton.setAttribute('aria-busy', isLoading ? 'true' : 'false');
}

function updateSelectedFileUI(file) {
    if (!dropzoneShell || !dropzoneBadge) {
        return;
    }

    if (!file) {
        if (fileInputLabel) {
            fileInputLabel.textContent = 'Drop a video here or browse';
        }
        dropzoneBadge.hidden = true;
        dropzoneBadge.innerHTML = '';
        dropzoneShell.classList.remove('has-error');
        dropzoneShell.classList.remove('has-selection');
        updateSubmitButtonAvailability(false);
        return;
    }

    if (fileInputLabel) {
        fileInputLabel.textContent = 'File selected';
    }

    const tooLarge = file.size > MAX_FILE_SIZE;
    dropzoneShell.classList.toggle('has-error', tooLarge);
    dropzoneShell.classList.add('has-selection');
    updateSubmitButtonAvailability(tooLarge);

    if (tooLarge) {
        dropzoneBadge.innerHTML = `
            <span class="dropzone-status dropzone-status-warning" aria-hidden="true">!</span>
            <div class="dropzone-badge-copy">
                <strong>File too large. Max 100MB.</strong>
                <span>${truncateFileName(file.name, 24)} · ${formatFileSizeMB(file.size)}</span>
            </div>
            <button type="button" class="dropzone-clear" aria-label="Clear selected file">×</button>
        `;
    } else {
        dropzoneBadge.innerHTML = `
            <span class="dropzone-status dropzone-status-success" aria-hidden="true">✓</span>
            <div class="dropzone-badge-copy">
                <strong>${truncateFileName(file.name, 24)}</strong>
                <span>${truncateFileName(file.name, 24)} · ${formatFileSizeMB(file.size)}</span>
            </div>
            <button type="button" class="dropzone-clear" aria-label="Clear selected file">×</button>
        `;
    }

    dropzoneBadge.hidden = false;

    const clearButton = dropzoneBadge.querySelector('.dropzone-clear');
    if (clearButton) {
        clearButton.addEventListener('click', clearSelectedFile, { once: true });
    }
}

function showSection(section) {
    if (!section) {
        return;
    }

    section.style.display = 'block';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            section.classList.add('is-visible');
        });
    });
}

function hideSection(section, callback) {
    if (!section) {
        if (callback) {
            callback();
        }
        return;
    }

    let finalized = false;
    let fallbackTimerId = null;

    const finalize = () => {
        if (finalized) {
            return;
        }
        finalized = true;
        window.clearTimeout(fallbackTimerId);
        section.style.display = 'none';
        section.removeEventListener('transitionend', onTransitionEnd);
        if (callback) {
            callback();
        }
    };

    const onTransitionEnd = (event) => {
        if (event.target !== section) {
            return;
        }
        finalize();
    };

    section.classList.remove('is-visible');
    section.addEventListener('transitionend', onTransitionEnd, { once: true });
    fallbackTimerId = window.setTimeout(finalize, 550);
}

function setSectionVisibility(section, isVisible, callback) {
    if (isVisible) {
        showSection(section);
        if (callback) {
            callback();
        }
        return;
    }

    hideSection(section, callback);
}

function setStatusText(message) {
    if (!statusText || typeof message !== 'string') {
        return;
    }

    window.clearTimeout(statusTextTimerId);
    statusText.classList.add('fading');
    statusTextTimerId = window.setTimeout(() => {
        statusText.textContent = message;
        statusText.classList.remove('fading');
    }, STATUS_FADE_MS);
}

function setGenderValue(value) {
    if (genderSelect) {
        genderSelect.value = value;
    }

    genderButtons.forEach((button) => {
        const isActive = button.dataset.genderValue === value;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setDownloadFormat(format) {
    activeDownloadFormat = format === 'gltf' ? 'gltf' : 'fbx';

    formatButtons.forEach((button) => {
        const isActive = button.dataset.formatValue === activeDownloadFormat;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (formatDescription) {
        formatDescription.textContent = FORMAT_DESCRIPTIONS[activeDownloadFormat];
    }
}

function syncNavState(activeSectionId) {
    const hasMatchingLink = navLinks.some((link) => link.dataset.scrollTarget === activeSectionId);
    if (!hasMatchingLink) {
        return;
    }

    navLinks.forEach((link) => {
        const isActive = link.dataset.scrollTarget === activeSectionId;
        link.classList.toggle('active', isActive);
    });
}

function updateSubmitButtonAvailability(disabled) {
    if (!submitButton) {
        return;
    }

    submitButton.disabled = disabled;
    submitButton.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function clearSelectedFile(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (videoInput) {
        videoInput.value = '';
    }

    updateSelectedFileUI(null);
    clearMessages();
}

function truncateFileName(name, limit) {
    if (!name || name.length <= limit) {
        return name || '';
    }

    return `${name.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function formatFileSizeMB(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateProgressStepper(stepIndex, isDone) {
    lastKnownProgressStep = Math.max(lastKnownProgressStep, stepIndex);

    progressSteps.forEach((step) => {
        const current = Number(step.dataset.step || step.dataset.stepIndex || '0');
        step.classList.remove('is-upcoming', 'is-active', 'is-complete');

        if (isDone || current < lastKnownProgressStep) {
            step.classList.add('is-complete');
            return;
        }

        if (current === lastKnownProgressStep) {
            step.classList.add('is-active');
            return;
        }

        step.classList.add('is-upcoming');
    });
}

function updateProgressFromStatus(status) {
    const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';

    if (normalizedStatus === 'done') {
        updateProgressStepper(4, true);
        return;
    }

    const mappedStep = PROGRESS_STATUS_MAP[normalizedStatus] || 2;
    updateProgressStepper(mappedStep, false);
}

function resetProgressStepper() {
    lastKnownProgressStep = 1;
    updateProgressStepper(1, false);
}

function updateDownloadButtonState() {
    if (!downloadButton) {
        return;
    }

    const label = activeDownloadFormat === 'gltf' ? 'Download glTF' : 'Download FBX';
    downloadButton.textContent = label;
}

function handleResetClick() {
    if (!resetButton) {
        return;
    }

    if (resetButton.classList.contains('reset-confirm')) {
        window.clearTimeout(resetGuardTimerId);
        resetGuardTimerId = null;
        resetButton.classList.remove('reset-confirm');
        resetButton.textContent = 'Process Another Video';
        resetForNextJob();
        return;
    }

    resetButton.classList.add('reset-confirm');
    resetButton.textContent = 'Are you sure? This will clear your result.';
    resetGuardTimerId = window.setTimeout(() => {
        if (!resetButton) {
            return;
        }
        resetButton.classList.remove('reset-confirm');
        resetButton.textContent = 'Process Another Video';
        resetGuardTimerId = null;
    }, 3000);
}

async function copyJobIdToClipboard() {
    if (!copyJobIdButton || !resultJobId) {
        return;
    }

    const jobId = resultJobId.textContent.trim();
    if (!jobId || jobId === '—') {
        return;
    }

    try {
        await navigator.clipboard.writeText(jobId);
        copyJobIdButton.textContent = '✓';
        copyJobIdButton.classList.add('copied');
        window.setTimeout(() => {
            copyJobIdButton.textContent = '⎘';
            copyJobIdButton.classList.remove('copied');
        }, 2000);
    } catch (error) {
        console.error('Clipboard copy failed:', error);
    }
}

function showViewerHint() {
    if (!viewerHint) {
        return;
    }

    window.clearTimeout(viewerHintTimerId);
    viewerHint.classList.remove('is-hidden');
    viewerHintTimerId = window.setTimeout(() => {
        hideViewerHint();
    }, 4000);
}

function hideViewerHint() {
    if (!viewerHint) {
        return;
    }

    window.clearTimeout(viewerHintTimerId);
    viewerHint.classList.add('is-hidden');
}

function handleVideoChange(event) {
    const target = event.target;
    const file = target && target.files && target.files[0] ? target.files[0] : null;
    clearMessages();

    if (!file) {
        updateSelectedFileUI(null);
        return;
    }

    if (!isAllowedVideo(file)) {
        showError('Invalid video format. Please upload MP4, MOV, AVI, or MKV. (MP4 works best to avoid random issues.)');
        videoInput.value = '';
        updateSelectedFileUI(null);
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        showError(`File size is too large. Maximum size is 100 MB, but your file is ${formatFileSize(file.size)}`);
        videoInput.value = '';
        updateSelectedFileUI(null);
        return;
    }

    const videoElement = document.createElement('video');
    videoElement.preload = 'metadata';

    videoElement.onloadedmetadata = function () {
        const duration = videoElement.duration;

        if (duration > MAX_DURATION) {
            showError(`Video duration is too long. Maximum duration is ${MAX_DURATION} seconds, but your video is ${duration.toFixed(2)} seconds`);
            videoInput.value = '';
            updateSelectedFileUI(null);
            return;
        }

        showSuccess(`Video validated successfully! (${duration.toFixed(2)}s, ${formatFileSize(file.size)})`);
    };

    videoElement.onerror = function () {
        showError('Unable to read video file. Please ensure it is a valid video format.');
        videoInput.value = '';
        updateSelectedFileUI(null);
    };

    videoElement.src = URL.createObjectURL(file);
}

function handleFormSubmit(event) {
    event.preventDefault();
    clearMessages();

    const file = videoInput && videoInput.files && videoInput.files[0] ? videoInput.files[0] : null;
    const gender = genderSelect ? genderSelect.value : '';

    if (!file) {
        showError('Please select a video file.');
        return;
    }

    if (!isAllowedVideo(file)) {
        showError('Invalid video format. Please upload MP4, MOV, AVI, or MKV. (MP4 works best to avoid random issues.)');
        return;
    }

    if (!gender) {
        showError('Please select a gender.');
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        showError('File size exceeds 100 MB limit.');
        return;
    }

    setSubmitLoading(true);
    displayPreview(file, gender);
    sendVideoRequest(file, gender);

    console.log('Form Data:', {
        fileName: file.name,
        fileSize: file.size,
        gender,
        timestamp: new Date().toISOString()
    });
}

async function sendVideoRequest(file, gender) {
    const uploadUrl = 'http://localhost:8001/upload';
    const processUrl = 'http://localhost:8001/process';
    const payload = new FormData();
    payload.append('video', file);
    payload.append('gender', gender);

    try {
        console.log('Starting upload request');
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: payload
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Upload request failed:', response.status, errorText);
            showError(`Upload failed: ${errorText || response.statusText}`);
            return;
        }

        const data = await response.json().catch(() => ({}));
        console.log('Upload response received:', data);
        showSuccess('Upload successful!');

        const key = data && data.key;
        if (!key) {
            console.error('Upload response missing key:', data);
            showError('Upload succeeded but response did not include an R2 key.');
            return;
        }

        console.log('Starting process request with key:', key);
        const processResponse = await fetch(processUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ r2_key: key })
        });

        if (!processResponse.ok) {
            const errorText = await processResponse.text();
            console.error('Process request failed:', processResponse.status, errorText);
            showError(`Process start failed: ${errorText || processResponse.statusText}`);
            return;
        }

        const processData = await processResponse.json().catch(() => ({}));
        const jobId = processData && processData.job_id;
        if (!jobId) {
            console.error('Process response missing job_id:', processData);
            showError('Process started response did not include a job ID.');
            return;
        }

        currentJobId = jobId;
        console.log('Process started with job_id:', jobId);
        showLoadingState('Job created. Waiting for processing to start...');
        updateProgressFromStatus('pending');

        if (jobPollIntervalId) {
            clearInterval(jobPollIntervalId);
            jobPollIntervalId = null;
            console.log('Cleared existing job poll interval');
        }

        let pollingFinished = false;
        const pollJob = async () => {
            const jobUrl = `http://localhost:8001/job/${jobId}`;
            console.log('Polling job status:', jobUrl);

            try {
                const jobResponse = await fetch(jobUrl);
                if (!jobResponse.ok) {
                    const errorText = await jobResponse.text();
                    console.error('Job poll failed:', jobResponse.status, errorText);
                    clearInterval(jobPollIntervalId);
                    jobPollIntervalId = null;
                    showError(`Job status check failed: ${errorText || jobResponse.statusText}`);
                    hideLoadingState();
                    return;
                }

                const job = await jobResponse.json();
                const status = typeof job.status === 'string' ? job.status.trim().toLowerCase() : '';
                console.log('Job status response:', job);
                console.log(status);
                updateStatusText(status, job);
                updateProgressFromStatus(status);

                if (status === 'done') {
                    clearInterval(jobPollIntervalId);
                    jobPollIntervalId = null;
                    pollingFinished = true;
                    currentJobId = null;
                    console.log('Job completed successfully');
                    hideLoadingState(() => {
                        onJobComplete(job);
                    });
                    return;
                }

                if (status === 'failed') {
                    clearInterval(jobPollIntervalId);
                    jobPollIntervalId = null;
                    pollingFinished = true;
                    currentJobId = null;
                    console.error('Job failed:', job.error);
                    hideLoadingState(() => {
                        showError(job.error || 'Job failed.');
                    });
                }
            } catch (pollError) {
                console.error('Job polling error:', pollError);
                clearInterval(jobPollIntervalId);
                jobPollIntervalId = null;
                pollingFinished = true;
                currentJobId = null;
                hideLoadingState(() => {
                    showError('Network error while checking job status. Please try again later.');
                });
            }
        };

        await pollJob();
        if (pollingFinished) {
            console.log('Initial poll reached a terminal state');
            return;
        }

        if (jobPollIntervalId === null) {
            jobPollIntervalId = setInterval(pollJob, 3000);
            console.log('Started job polling interval:', jobPollIntervalId);
        }
    } catch (error) {
        console.error('Upload error:', error);
        showError('Network error while uploading. Please try again later.');
    }
}

function showLoadingState(message) {
    if (uploadForm) {
        uploadForm.classList.add('hidden');
    }

    if (statusText && message) {
        statusText.textContent = message;
        statusText.classList.remove('fading');
    }

    resetProgressStepper();
    updateProgressFromStatus('pending');
    setStatusText(message || 'Waiting to start...');
    setSectionVisibility(resultStage, false);
    setSectionVisibility(loadingStage, true);
    console.log('Loading section shown');
}

function hideLoadingState(callback) {
    if (uploadForm) {
        uploadForm.classList.remove('hidden');
    }

    setSubmitLoading(false);
    setSectionVisibility(loadingStage, false, callback);
    console.log('Loading section hidden');
}

function updateStatusText(status, job) {
    const errorSuffix = job && job.error ? `: ${job.error}` : '';
    setStatusText(`Current status: ${status}${status === 'failed' ? errorSuffix : ''}`);
    console.log('Updated status text:', `Current status: ${status}${status === 'failed' ? errorSuffix : ''}`);
}

function onJobComplete(job) {
    if (!job || (!job.output_gltf_key && !job.output_fbx_key)) {
        showError('Job completed, but no downloadable output key was returned.');
        return;
    }

    if (!resultSection || !viewerCanvas) {
        showError('3D viewer is not available in the page.');
        return;
    }

    if (activeViewer) {
        activeViewer.dispose();
        activeViewer = null;
    }

    completedJob = job;
    populateResultMeta(job);
    viewerCanvas.classList.remove('model-loaded');
    setSectionVisibility(resultStage, true);
    smoothTo('result');
    updateProgressFromStatus('done');
    updateDownloadButtonState();
    showViewerHint();

    if (downloadButton) {
        downloadButton.classList.remove('button-shimmer-once');
        requestAnimationFrame(() => {
            downloadButton.classList.add('button-shimmer-once');
        });
    }

    const gltfUrl = `https://pub-0506be8f79424807a9442365f3ef284c.r2.dev/${job.output_gltf_key}`;
    const viewerHost = viewerCanvas.parentElement || viewerCanvas;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({
        canvas: viewerCanvas,
        antialias: true,
        alpha: false
    });
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    const loader = new THREE.GLTFLoader();
    const clock = new THREE.Clock();
    const backgroundColor = 0x1c1c1f;
    let mixer = null;
    let loadedModel = null;
    let animationFrameId = null;
    let resizeObserver = null;
    let disposed = false;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(backgroundColor, 1);
    renderer.physicallyCorrectLights = true;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    scene.background = new THREE.Color(backgroundColor);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x2b2f3a, 1.2);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    const fillLight = new THREE.DirectionalLight(0xbfc8ff, 1.1);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);

    keyLight.position.set(6, 10, 8);
    fillLight.position.set(-6, 4, 10);
    rimLight.position.set(0, 6, -10);

    scene.add(ambientLight);
    scene.add(hemisphereLight);
    scene.add(keyLight);
    scene.add(fillLight);
    scene.add(rimLight);

    controls.enableDamping = true;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0, 0);
    camera.position.set(0, 1, 4);
    controls.update();

    const resizeRenderer = () => {
        const width = Math.max(viewerCanvas.clientWidth || viewerHost.clientWidth || 1, 1);
        const height = Math.max(viewerCanvas.clientHeight || viewerHost.clientHeight || 1, 1);

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };

    const renderFrame = () => {
        if (disposed) {
            return;
        }

        animationFrameId = requestAnimationFrame(renderFrame);

        if (mixer) {
            mixer.update(clock.getDelta());
        } else {
            clock.getDelta();
        }

        controls.update();
        renderer.render(scene, camera);
    };

    const disposeMaterial = (material) => {
        if (!material) {
            return;
        }

        const materialList = Array.isArray(material) ? material : [material];
        materialList.forEach((entry) => {
            entry.dispose();
        });
    };

    const disposeModel = (model) => {
        if (!model) {
            return;
        }

        model.traverse((node) => {
            if (node.geometry) {
                node.geometry.dispose();
            }
            if (node.material) {
                disposeMaterial(node.material);
            }
        });
    };

    // Fit the camera from the model's bounding sphere so the full asset is visible.
    const frameModel = (model) => {
        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.sub(center);

        const centeredBounds = new THREE.Box3().setFromObject(model);
        const sphere = centeredBounds.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 0.5);
        const verticalDistance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const horizontalDistance = verticalDistance / camera.aspect;
        const distance = Math.max(verticalDistance, horizontalDistance) * 1.35;

        camera.position.set(radius * 0.35, radius * 0.18, distance);
        camera.near = Math.max(radius / 100, 0.01);
        camera.far = Math.max(radius * 40, 100);
        camera.updateProjectionMatrix();

        controls.target.set(0, 0, 0);
        controls.minDistance = radius * 0.6;
        controls.maxDistance = radius * 10;
        controls.update();
    };

    const disposeViewer = () => {
        disposed = true;

        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
        }
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }

        window.removeEventListener('resize', resizeRenderer);
        controls.dispose();

        if (loadedModel) {
            scene.remove(loadedModel);
            disposeModel(loadedModel);
            loadedModel = null;
        }

        renderer.dispose();
    };

    activeViewer = {
        dispose: disposeViewer
    };

    const startViewer = () => {
        if (disposed) {
            return;
        }

        resizeRenderer();
        renderFrame();

        loader.load(
            gltfUrl,
            (gltf) => {
                if (disposed) {
                    disposeModel(gltf.scene);
                    return;
                }

                loadedModel = gltf.scene;
                scene.add(loadedModel);
                frameModel(loadedModel);

                if (gltf.animations && gltf.animations.length > 0) {
                    mixer = new THREE.AnimationMixer(loadedModel);
                    mixer.clipAction(gltf.animations[0]).play();
                }

                viewerCanvas.classList.add('model-loaded');
                showSuccess('Motion capture complete. 3D result loaded.');
            },
            undefined,
            (error) => {
                console.error('Failed to load glTF:', error);
                if (activeViewer) {
                    activeViewer.dispose();
                    activeViewer = null;
                }
                showError('Motion capture completed, but the 3D model could not be loaded.');
            }
        );
    };

    const waitForViewerLayout = () => {
        const width = viewerCanvas.clientWidth || viewerHost.clientWidth || 0;
        const height = viewerCanvas.clientHeight || viewerHost.clientHeight || 0;
        console.log('Viewer canvas size at init:', width, height);

        if (width > 0 && height > 0) {
            startViewer();
            return;
        }

        resizeObserver = new ResizeObserver(() => {
            const nextWidth = viewerCanvas.clientWidth || viewerHost.clientWidth || 0;
            const nextHeight = viewerCanvas.clientHeight || viewerHost.clientHeight || 0;
            console.log('Viewer canvas size at init:', nextWidth, nextHeight);

            if (nextWidth > 0 && nextHeight > 0) {
                resizeObserver.disconnect();
                resizeObserver = null;
                startViewer();
            }
        });
        resizeObserver.observe(viewerHost);
    };

    window.addEventListener('resize', resizeRenderer);
    requestAnimationFrame(waitForViewerLayout);
}

function handleDownload() {
    if (!completedJob) {
        showError('No completed job is available for download.');
        return;
    }

    const key = activeDownloadFormat === 'gltf'
        ? completedJob.output_gltf_key
        : completedJob.output_fbx_key;

    if (!key) {
        showError(`${activeDownloadFormat === 'gltf' ? 'glTF' : 'FBX'} output is not available for download.`);
        return;
    }

    const url = `https://pub-0506be8f79424807a9442365f3ef284c.r2.dev/${key}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

function resetForNextJob() {
    if (jobPollIntervalId) {
        clearInterval(jobPollIntervalId);
        jobPollIntervalId = null;
    }

    if (activeViewer) {
        activeViewer.dispose();
        activeViewer = null;
    }

    window.clearTimeout(statusTextTimerId);
    window.clearTimeout(viewerHintTimerId);
    window.clearTimeout(resetGuardTimerId);
    currentJobId = null;
    completedJob = null;

    if (uploadForm) {
        uploadForm.classList.remove('hidden');
        uploadForm.reset();
    }

    if (videoInput) {
        videoInput.value = '';
    }

    if (genderSelect) {
        setGenderValue('');
    }

    if (videoPreview) {
        videoPreview.classList.add('hidden');
    }

    if (statusText) {
        statusText.classList.remove('fading');
        statusText.textContent = 'Waiting to start...';
    }

    if (viewerCanvas) {
        viewerCanvas.classList.remove('model-loaded');
    }

    if (resetButton) {
        resetButton.classList.remove('reset-confirm');
        resetButton.textContent = 'Process Another Video';
    }

    setSubmitLoading(false);
    updateSubmitButtonAvailability(false);
    updateSelectedFileUI(null);
    populateResultMeta(null);
    resetProgressStepper();
    hideViewerHint();
    setDownloadFormat('fbx');
    updateDownloadButtonState();
    setSectionVisibility(loadingStage, false);
    setSectionVisibility(resultStage, false);
    smoothTo('upload');
    clearMessages();
}

function displayPreview(file, gender) {
    const videoElement = document.createElement('video');
    videoElement.preload = 'metadata';

    videoElement.onloadedmetadata = function () {
        const duration = videoElement.duration;
        document.getElementById('previewFileName').textContent = file.name;
        document.getElementById('previewFileSize').textContent = formatFileSize(file.size);
        document.getElementById('previewDuration').textContent = `${duration.toFixed(2)} seconds`;
        document.getElementById('previewGender').textContent = `${gender.charAt(0).toUpperCase()}${gender.slice(1)}`;
        videoPreview.classList.remove('hidden');
    };

    videoElement.src = URL.createObjectURL(file);
}

function showError(message) {
    setSubmitLoading(false);
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
    successMessage.classList.remove('show');
}

function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.add('show');
    errorMessage.classList.remove('show');
}

function clearMessages() {
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');
}

function formatFileSize(bytes) {
    if (bytes === 0) {
        return '0 Bytes';
    }

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function isAllowedVideo(file) {
    const allowedExtensions = ['mp4', 'mov', 'avi', 'mkv'];
    const allowedMimeTypes = [
        'video/mp4',
        'video/quicktime',
        'video/x-msvideo',
        'video/x-matroska'
    ];

    const name = (file.name || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    const type = (file.type || '').toLowerCase();
    return Boolean((ext && allowedExtensions.includes(ext)) || (type && allowedMimeTypes.includes(type)));
}

function formatDisplayDate(value) {
    if (!value) {
        return '—';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString();
}

function populateResultMeta(job) {
    if (resultJobId) {
        resultJobId.textContent = job && job.job_id ? job.job_id : '—';
    }

    if (resultGender) {
        const gender = (genderSelect && genderSelect.value) || (job && job.gender) || '';
        resultGender.textContent = gender ? `${gender.charAt(0).toUpperCase()}${gender.slice(1)}` : '—';
    }

    if (resultCreatedAt) {
        resultCreatedAt.textContent = formatDisplayDate(job && job.created_at);
    }
}
