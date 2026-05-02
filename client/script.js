// Constants
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB in bytes
const MAX_DURATION = 10; // 10 seconds

// DOM Elements
const uploadForm = document.getElementById('uploadForm');
const videoInput = document.getElementById('videoInput');
const genderSelect = document.getElementById('genderSelect');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const videoPreview = document.getElementById('videoPreview');

// Event Listeners
videoInput.addEventListener('change', handleVideoChange);
uploadForm.addEventListener('submit', handleFormSubmit);

/**
 * Handle video file selection
 */
function handleVideoChange(e) {
    const target = e.target;
    const file = (target && target.files && target.files[0]) ? target.files[0] : null;
    clearMessages();

    if (!file) return;

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
    showSuccess('Form submitted successfully!');

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
    const API_URL = 'http://localhost:8001/upload';
    const payload = new FormData();
    payload.append('video', file);
    payload.append('gender', gender);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: payload
        });

        if (!response.ok) {
            const errorText = await response.text();
            showError(`Upload failed: ${errorText || response.statusText}`);
            return;
        }

        const data = await response.json().catch(() => ({}));
        showSuccess('Upload successful!');
        console.log('API Response:', data);
    } catch (err) {
        showError('Network error while uploading. Please try again later.');
        console.error('Upload error:', err);
    }
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
