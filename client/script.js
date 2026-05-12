// Constants
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB in bytes
const MAX_DURATION = 30; // 30 seconds

// DOM Elements
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
const downloadFbxButton = document.getElementById('downloadFbxButton');
const resetButton = document.getElementById('resetButton');
let jobPollIntervalId = null;
let activeViewer = null;
let currentJobId = null;
let completedJob = null;

// Event Listeners
videoInput.addEventListener('change', handleVideoChange);
uploadForm.addEventListener('submit', handleFormSubmit);
if (downloadFbxButton) {
    downloadFbxButton.addEventListener('click', handleDownloadFbx);
}
if (resetButton) {
    resetButton.addEventListener('click', resetForNextJob);
}

/**
 * Handle video file selection
 */
function handleVideoChange(e) {
    const target = e.target;
    const file = (target && target.files && target.files[0]) ? target.files[0] : null;
    clearMessages();

    if (!file) return;

    // Check file type
    if (!isAllowedVideo(file)) {
        showError('Invalid video format. Please upload MP4, MOV, AVI, or MKV. (MP4 works best to avoid random issues.)');
        videoInput.value = '';
        return;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
        showError(`File size is too large. Maximum size is 30 MB, but your file is ${formatFileSize(file.size)}`);
        videoInput.value = '';
        return;
    }

    // Check video duration
    const videoElement = document.createElement('video');
    videoElement.preload = 'metadata';

    videoElement.onloadedmetadata = function () {
        const duration = videoElement.duration;

        if (duration > MAX_DURATION) {
            showError(`Video duration is too long. Maximum duration is ${MAX_DURATION} seconds, but your video is ${duration.toFixed(2)} seconds`);
            videoInput.value = '';
            return;
        }

        // All validations passed
        showSuccess(`Video validated successfully! (${duration.toFixed(2)}s, ${formatFileSize(file.size)})`);
    };

    videoElement.onerror = function () {
        showError('Unable to read video file. Please ensure it is a valid video format.');
        videoInput.value = '';
    };

    videoElement.src = URL.createObjectURL(file);
}

/**
 * Handle form submission
 */
function handleFormSubmit(e) {
    e.preventDefault();
    clearMessages();

    const file = (videoInput && videoInput.files && videoInput.files[0]) ? videoInput.files[0] : null;
    const gender = genderSelect ? genderSelect.value : '';

    // Validate inputs
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

    // Final validation checks
    if (file.size > MAX_FILE_SIZE) {
        showError('File size exceeds 30 MB limit.');
        return;
    }

    // Display preview
    displayPreview(file, gender);
    // Send request to API
    sendVideoRequest(file, gender);

    // Log form data (for debugging)
    const formData = {
        fileName: file.name,
        fileSize: file.size,
        gender: gender,
        timestamp: new Date().toISOString()
    };
    console.log('Form Data:', formData);
}

/**
 * Send video to FastAPI endpoint
 */
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
                    return;
                }

                const job = await jobResponse.json();
                console.log('Job status response:', job);
                updateStatusText(job.status, job);

                if (job.status === 'done') {
                    clearInterval(jobPollIntervalId);
                    jobPollIntervalId = null;
                    pollingFinished = true;
                    currentJobId = null;
                    console.log('Job completed successfully');
                    hideLoadingState();
                    onJobComplete(job);
                    return;
                }

                if (job.status === 'failed') {
                    clearInterval(jobPollIntervalId);
                    jobPollIntervalId = null;
                    pollingFinished = true;
                    currentJobId = null;
                    console.error('Job failed:', job.error);
                    hideLoadingState();
                    showError(job.error || 'Job failed.');
                }
            } catch (pollError) {
                console.error('Job polling error:', pollError);
                clearInterval(jobPollIntervalId);
                jobPollIntervalId = null;
                pollingFinished = true;
                currentJobId = null;
                hideLoadingState();
                showError('Network error while checking job status. Please try again later.');
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
    } catch (err) {
        showError('Network error while uploading. Please try again later.');
        console.error('Upload error:', err);
    }
}

function onJobComplete(job) {
    if (!job || !job.output_gltf_key) {
        showError('Job completed, but no glTF output key was returned.');
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
    resultSection.classList.remove('hidden');

    const gltfUrl = `https://pub-0506be8f79424807a9442365f3ef284c.r2.dev/${job.output_gltf_key}`;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111111');

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({
        canvas: viewerCanvas,
        antialias: true,
        alpha: false
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8);
    directionalLight.position.set(5, 8, 6);
    scene.add(directionalLight);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const clock = new THREE.Clock();
    const loader = new THREE.GLTFLoader();
    let mixer = null;
    let animationFrameId = null;

    const resizeRenderer = () => {
        const width = viewerCanvas.clientWidth || viewerCanvas.parentElement.clientWidth || 1;
        const height = viewerCanvas.clientHeight || 500;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };

    const renderFrame = () => {
        animationFrameId = requestAnimationFrame(renderFrame);
        const delta = clock.getDelta();
        if (mixer) {
            mixer.update(delta);
        }
        controls.update();
        renderer.render(scene, camera);
    };

    const handleResize = () => {
        resizeRenderer();
    };

    window.addEventListener('resize', handleResize);
    resizeRenderer();

    activeViewer = {
        dispose() {
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }
            window.removeEventListener('resize', handleResize);
            controls.dispose();
            renderer.dispose();
        }
    };

    loader.load(
        gltfUrl,
        (gltf) => {
            const model = gltf.scene;
            scene.add(model);

            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const scale = 3 / maxDim;

            model.position.sub(center);
            model.scale.setScalar(scale);

            const scaledBox = new THREE.Box3().setFromObject(model);
            const sphere = scaledBox.getBoundingSphere(new THREE.Sphere());
            const radius = sphere.radius || 1;
            const fitHeightDistance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
            const fitWidthDistance = fitHeightDistance / camera.aspect;
            const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.25;

            camera.position.set(distance * 0.75, radius * 0.6, distance);
            camera.near = Math.max(radius / 100, 0.01);
            camera.far = Math.max(distance * 10, 100);
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();

            controls.target.set(0, 0, 0);
            controls.minDistance = radius * 0.5;
            controls.maxDistance = distance * 4;
            controls.update();

            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);
                mixer.clipAction(gltf.animations[0]).play();
            }

            renderFrame();
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
}

function handleDownloadFbx() {
    if (!completedJob || !completedJob.output_fbx_key) {
        showError('FBX output is not available for download.');
        return;
    }

    const fbxUrl = `https://pub-0506be8f79424807a9442365f3ef284c.r2.dev/${completedJob.output_fbx_key}`;
    window.open(fbxUrl, '_blank', 'noopener,noreferrer');
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

    currentJobId = null;
    completedJob = null;

    if (resultSection) {
        resultSection.classList.add('hidden');
    }
    if (loadingSection) {
        loadingSection.classList.add('hidden');
    }
    if (uploadForm) {
        uploadForm.classList.remove('hidden');
        uploadForm.reset();
    }
    if (videoInput) {
        videoInput.value = '';
    }
    if (genderSelect) {
        genderSelect.value = '';
    }
    if (videoPreview) {
        videoPreview.classList.add('hidden');
    }
    if (statusText) {
        statusText.textContent = 'Waiting to start...';
    }

    clearMessages();
}

function showLoadingState(message) {
    if (uploadForm) {
        uploadForm.classList.add('hidden');
    }
    if (loadingSection) {
        loadingSection.classList.remove('hidden');
    }
    if (statusText && message) {
        statusText.textContent = message;
    }
    console.log('Loading section shown');
}

function hideLoadingState() {
    if (loadingSection) {
        loadingSection.classList.add('hidden');
    }
    if (uploadForm) {
        uploadForm.classList.remove('hidden');
    }
    console.log('Loading section hidden');
}

function updateStatusText(status, job) {
    if (!statusText) {
        return;
    }

    const errorSuffix = job && job.error ? `: ${job.error}` : '';
    statusText.textContent = `Current status: ${status}${status === 'failed' ? errorSuffix : ''}`;
    console.log('Updated status text:', statusText.textContent);
}

/**
 * Display video preview information
 */
function displayPreview(file, gender) {
    const videoElement = document.createElement('video');
    videoElement.preload = 'metadata';

    videoElement.onloadedmetadata = function () {
        const duration = videoElement.duration;

        const videoDetails = {
            fileName: file.name,
            fileSize: formatFileSize(file.size),
            duration: `${duration.toFixed(2)} seconds`,
            gender: gender.charAt(0).toUpperCase() + gender.slice(1)
        };

        document.getElementById('previewFileName').textContent = videoDetails.fileName;
        document.getElementById('previewFileSize').textContent = videoDetails.fileSize;
        document.getElementById('previewDuration').textContent = videoDetails.duration;
        document.getElementById('previewGender').textContent = videoDetails.gender;

        videoPreview.classList.remove('hidden');
    };

    videoElement.src = URL.createObjectURL(file);
}

/**
 * Show error message
 */
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
    successMessage.classList.remove('show');
}

/**
 * Show success message
 */
function showSuccess(message) {
    successMessage.textContent = message;
    successMessage.classList.add('show');
    errorMessage.classList.remove('show');
}

/**
 * Clear all messages
 */
function clearMessages() {
    errorMessage.classList.remove('show');
    successMessage.classList.remove('show');
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Check allowed video formats
 */
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

    const extOk = ext && allowedExtensions.includes(ext);
    const mimeOk = type && allowedMimeTypes.includes(type);

    return Boolean(extOk || mimeOk);
}
