// api/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream');
const util = require('util');
const streamPipeline = util.promisify(pipeline);
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { TelegramApi } = require('telegram');
const { StringSession } = require('telegram/sessions');

const app = express();

// ------------------------
// Security & Performance Middleware
// ------------------------
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/upload', limiter);

// ------------------------
// CONFIG - Enhanced for 6GB
// ------------------------
const BOT_TOKEN = '8303908376:AAEL1dL0BjpmpbdYjZ5yQmgb1UJLa_OMbGk';
const CHANNEL_ID = -1002995694885;
const API_ID = 20288994;
const API_HASH = "d702614912f1ad370a0d18786002adbf";
const TELEGRAM_MAX_FILE_BYTES = 6 * 1024 * 1024 * 1024; // 6 GB
const UPLOAD_DIR = '/tmp/uploads';
const CHUNK_SIZE = 2000 * 1024 * 1024; // 2GB chunks for large files

// Video file extensions for streaming
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.m2ts'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'];

// ------------------------
// Telegram clients init
// ------------------------
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Initialize Telegram Client for large file uploads
let telegramClient = null;
const stringSession = new StringSession(''); // You'll need to get this session string

async function initTelegramClient() {
  try {
    telegramClient = new TelegramApi(stringSession, API_ID, API_HASH, {
      connectionRetries: 5,
    });
    
    await telegramClient.start({
      phoneNumber: async () => {
        // You'll need to implement phone number input
        // For now, we'll use bot for smaller files and client for larger ones
        console.log('Telegram client initialization requires phone number');
        return null;
      },
      password: async () => '',
      phoneCode: async () => '',
      onError: (err) => console.log('Telegram client error:', err),
    });
    
    console.log('✅ Telegram client initialized');
  } catch (error) {
    console.log('⚠️ Telegram client initialization failed, using bot only:', error.message);
  }
}

// Initialize client on startup
initTelegramClient();

// ------------------------
// Ensure directories
// ------------------------
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(path.join(__dirname, 'public'));

// ------------------------
// Enhanced Multer config for 6GB
// ------------------------
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { 
    fileSize: TELEGRAM_MAX_FILE_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Accept all file types
    cb(null, true);
  }
});

// ------------------------
// Enhanced Helpers
// ------------------------
function safeFileName(name) {
  if (!name) return 'file';
  const ext = path.extname(name) || '';
  const base = path.basename(name, ext)
    .replace(/[\r\n"'`]/g, '_')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[^\w\s\-\.]/g, '_')
    .trim()
    .slice(0, 100);
  return (base || 'file') + ext;
}

function isVideoFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

function isAudioFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

function makeDownloadUrl(req, fileId, originalName) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host || req.get('host');
  const safeName = encodeURIComponent(safeFileName(originalName || 'file'));
  return `${protocol}://${host}/download/${fileId}?filename=${safeName}`;
}

function makeStreamUrl(req, fileId, originalName) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host || req.get('host');
  const safeName = encodeURIComponent(safeFileName(originalName || 'file'));
  return `${protocol}://${host}/stream/${fileId}?filename=${safeName}`;
}

function makePlayerUrl(req, fileId, originalName) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers.host || req.get('host');
  const safeName = encodeURIComponent(safeFileName(originalName || 'file'));
  return `${protocol}://${host}/player/${fileId}?filename=${safeName}`;
}

// ------------------------
// Enhanced file upload with 6GB support
// ------------------------
async function uploadLargeFile(filePath, originalName, chatId) {
  const stats = await fs.stat(filePath);
  
  // Use Telegram Client for files larger than 2GB
  if (stats.size > 2000 * 1024 * 1024 && telegramClient) {
    try {
      console.log('📤 Using Telegram Client for large file upload...');
      
      // Upload using Telegram Client which supports larger files
      const result = await telegramClient.sendFile(chatId, {
        file: filePath,
        caption: `📁 ${originalName}\n💾 Size: ${formatFileSize(stats.size)}`,
        progressCallback: (progress) => {
          console.log(`Upload progress: ${Math.round(progress * 100)}%`);
        }
      });
      
      return result;
    } catch (error) {
      console.log('⚠️ Telegram Client upload failed, falling back to bot:', error.message);
    }
  }
  
  // Use regular bot for smaller files or if client failed
  if (stats.size <= 2000 * 1024 * 1024) { // 2GB or less, single upload
    return await bot.sendDocument(chatId, fs.createReadStream(filePath), {
      caption: `📁 ${originalName}\n💾 Size: ${formatFileSize(stats.size)}`
    });
  }

  // For files larger than 2GB without client, we need to split them
  const chunks = Math.ceil(stats.size / CHUNK_SIZE);
  const messages = [];

  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, stats.size);
    const chunkPath = `${filePath}.chunk${i}`;
    
    // Create chunk file
    const readStream = fs.createReadStream(filePath, { start, end: end - 1 });
    const writeStream = fs.createWriteStream(chunkPath);
    await streamPipeline(readStream, writeStream);
    
    try {
      const message = await bot.sendDocument(chatId, fs.createReadStream(chunkPath), {
        caption: `📁 ${originalName} (Part ${i + 1}/${chunks})\n💾 Chunk Size: ${formatFileSize(end - start)}`
      });
      messages.push(message);
    } finally {
      await fs.unlink(chunkPath).catch(() => {});
    }
  }

  return messages[0]; // Return first chunk message
}

function formatFileSize(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// ------------------------
// Hostio Upload Page Route
// ------------------------
app.get('/hostio', (req, res) => {
  const hostioHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hostio - File Upload & Sharing</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(20px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
            max-width: 600px;
            width: 100%;
            text-align: center;
        }

        .logo {
            font-size: 3rem;
            font-weight: bold;
            color: white;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .subtitle {
            color: rgba(255, 255, 255, 0.9);
            margin-bottom: 30px;
            font-size: 1.1rem;
        }

        .upload-section {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 30px;
            margin-bottom: 20px;
            border: 2px dashed rgba(255, 255, 255, 0.3);
            transition: all 0.3s ease;
            cursor: pointer;
            position: relative;
        }

        .upload-section:hover {
            border-color: rgba(255, 255, 255, 0.6);
            background: rgba(255, 255, 255, 0.15);
        }

        .upload-section.dragover {
            border-color: #00ff88;
            background: rgba(0, 255, 136, 0.1);
        }

        .upload-icon {
            font-size: 4rem;
            color: rgba(255, 255, 255, 0.7);
            margin-bottom: 15px;
        }

        .upload-text {
            color: white;
            font-size: 1.2rem;
            margin-bottom: 20px;
        }

        .file-input {
            display: none;
        }

        .upload-btn, .url-btn {
            background: linear-gradient(45deg, #00ff88, #00d4ff);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            margin: 5px;
            display: inline-block;
            text-decoration: none;
        }

        .upload-btn:hover, .url-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 255, 136, 0.4);
        }

        .url-section {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .url-input {
            width: 100%;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 1rem;
            margin-bottom: 15px;
        }

        .url-input::placeholder {
            color: rgba(255, 255, 255, 0.7);
        }

        .progress-section {
            display: none;
            margin-top: 20px;
        }

        .progress-bar {
            width: 100%;
            height: 10px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 5px;
            overflow: hidden;
            margin-bottom: 10px;
        }

        .progress-fill {
            height: 100%;
            background: linear-gradient(45deg, #00ff88, #00d4ff);
            width: 0%;
            transition: width 0.3s ease;
        }

        .progress-text {
            color: white;
            font-size: 0.9rem;
        }

        .result-section {
            display: none;
            background: rgba(0, 255, 136, 0.1);
            border: 1px solid rgba(0, 255, 136, 0.3);
            border-radius: 15px;
            padding: 20px;
            margin-top: 20px;
        }

        .result-links {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            justify-content: center;
            margin-top: 15px;
        }

        .result-link {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            text-decoration: none;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9rem;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .result-link:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-top: 30px;
        }

        .feature {
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 10px;
            text-align: center;
        }

        .feature-icon {
            font-size: 2rem;
            margin-bottom: 10px;
        }

        .feature-text {
            color: white;
            font-size: 0.9rem;
        }

        .copy-btn {
            background: transparent;
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: white;
            padding: 5px 10px;
            border-radius: 15px;
            cursor: pointer;
            font-size: 0.8rem;
            margin-left: 10px;
            transition: all 0.3s ease;
        }

        .copy-btn:hover {
            background: rgba(255, 255, 255, 0.1);
        }

        .error-message {
            color: #ff6b6b;
            background: rgba(255, 107, 107, 0.1);
            border: 1px solid rgba(255, 107, 107, 0.3);
            padding: 10px;
            border-radius: 10px;
            margin-top: 15px;
            display: none;
        }

        @media (max-width: 768px) {
            .container {
                padding: 20px;
                margin: 10px;
            }
            
            .logo {
                font-size: 2rem;
            }
            
            .upload-icon {
                font-size: 3rem;
            }
            
            .features {
                grid-template-columns: repeat(2, 1fr);
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">🚀 Hostio</div>
        <div class="subtitle">Upload & Share Files up to 6GB instantly</div>
        
        <div class="upload-section" id="uploadSection">
            <div class="upload-icon">📁</div>
            <div class="upload-text">Drag & Drop files here or click to browse</div>
            <input type="file" class="file-input" id="fileInput" multiple>
            <button class="upload-btn" onclick="document.getElementById('fileInput').click()">
                📤 Choose Files
            </button>
        </div>

        <div class="url-section">
            <input type="text" class="url-input" id="urlInput" placeholder="🔗 Or paste a file URL here...">
            <button class="url-btn" onclick="uploadFromURL()">
                ⬇️ Upload from URL
            </button>
        </div>

        <div class="progress-section" id="progressSection">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="progress-text" id="progressText">Uploading...</div>
        </div>

        <div class="result-section" id="resultSection">
            <h3 style="color: white; margin-bottom: 15px;">✅ Upload Successful!</h3>
            <div id="fileInfo"></div>
            <div class="result-links" id="resultLinks"></div>
        </div>

        <div class="error-message" id="errorMessage"></div>

        <div class="features">
            <div class="feature">
                <div class="feature-icon">🚄</div>
                <div class="feature-text">6GB Max Size</div>
            </div>
            <div class="feature">
                <div class="feature-icon">🔒</div>
                <div class="feature-text">Secure Storage</div>
            </div>
            <div class="feature">
                <div class="feature-icon">🎬</div>
                <div class="feature-text">Media Streaming</div>
            </div>
            <div class="feature">
                <div class="feature-icon">⚡</div>
                <div class="feature-text">Instant Links</div>
            </div>
        </div>
    </div>

    <script>
        const uploadSection = document.getElementById('uploadSection');
        const fileInput = document.getElementById('fileInput');
        const progressSection = document.getElementById('progressSection');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const resultSection = document.getElementById('resultSection');
        const errorMessage = document.getElementById('errorMessage');
        const fileInfo = document.getElementById('fileInfo');
        const resultLinks = document.getElementById('resultLinks');

        // Drag and drop functionality
        uploadSection.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadSection.classList.add('dragover');
        });

        uploadSection.addEventListener('dragleave', () => {
            uploadSection.classList.remove('dragover');
        });

        uploadSection.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadSection.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                uploadFiles(files);
            }
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                uploadFiles(files);
            }
        });

        // Upload files function
        async function uploadFiles(files) {
            hideError();
            hideResult();
            
            for (let i = 0; i < files.length; i++) {
                await uploadSingleFile(files[i]);
            }
        }

        // Upload single file
        async function uploadSingleFile(file) {
            const formData = new FormData();
            formData.append('file', file);

            showProgress();
            progressText.textContent = \`Uploading \${file.name}...\`;

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (result.success) {
                    showResult(result);
                } else {
                    showError(result.error || 'Upload failed');
                }
            } catch (error) {
                showError('Upload failed: ' + error.message);
            } finally {
                hideProgress();
            }
        }

        // Upload from URL
        async function uploadFromURL() {
            const url = document.getElementById('urlInput').value.trim();
            
            if (!url) {
                showError('Please enter a valid URL');
                return;
            }

            hideError();
            hideResult();
            showProgress();
            progressText.textContent = 'Downloading from URL...';

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ file_url: url })
                });

                const result = await response.json();

                if (result.success) {
                    showResult(result);
                    document.getElementById('urlInput').value = '';
                } else {
                    showError(result.error || 'Upload failed');
                }
            } catch (error) {
                showError('Upload failed: ' + error.message);
            } finally {
                hideProgress();
            }
        }

        // UI Helper functions
        function showProgress() {
            progressSection.style.display = 'block';
            progressFill.style.width = '100%';
        }

        function hideProgress() {
            progressSection.style.display = 'none';
            progressFill.style.width = '0%';
        }

        function showResult(result) {
            resultSection.style.display = 'block';
            
            fileInfo.innerHTML = \`
                <div style="color: white; margin-bottom: 10px;">
                    <strong>\${result.file_name}</strong><br>
                    <small>Size: \${result.file_size_formatted} | Type: \${result.file_type}</small>
                </div>
            \`;

            resultLinks.innerHTML = '';
            
            // Download link
            addResultLink('📥 Download', result.download_url);
            
            // Stream/Player links for media files
            if (result.supports_streaming) {
                addResultLink('🎬 Player', result.player_url);
                addResultLink('📡 Stream', result.stream_url);
            }
        }

        function addResultLink(text, url) {
            const link = document.createElement('a');
            link.className = 'result-link';
            link.href = url;
            link.target = '_blank';
            link.innerHTML = \`\${text} <button class="copy-btn" onclick="copyToClipboard('\${url}', event)">Copy</button>\`;
            resultLinks.appendChild(link);
        }

        function showError(message) {
            errorMessage.textContent = message;
            errorMessage.style.display = 'block';
        }

        function hideError() {
            errorMessage.style.display = 'none';
        }

        function hideResult() {
            resultSection.style.display = 'none';
        }

        // Copy to clipboard function
        function copyToClipboard(text, event) {
            event.preventDefault();
            event.stopPropagation();
            
            navigator.clipboard.writeText(text).then(() => {
                const btn = event.target;
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            });
        }

        // Enter key support for URL input
        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                uploadFromURL();
            }
        });
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(hostioHTML);
});

// ------------------------
// Enhanced Upload endpoint with 6GB support
// ------------------------
app.post('/upload', upload.single('file'), async (req, res) => {
  let filePath = null;
  
  try {
    let originalName;
    let fileSize;

    // Handle file upload
    if (req.file) {
      filePath = req.file.path;
      originalName = req.file.originalname || req.file.filename;
      fileSize = req.file.size;
    }
    // Handle URL upload
    else if (req.body?.file_url) {
      const fileUrl = req.body.file_url;
      originalName = path.basename((fileUrl.split('?')[0] || '').trim()) || 'file';
      filePath = path.join(UPLOAD_DIR, `${Date.now()}_${safeFileName(originalName)}`);

      console.log(`📥 Downloading from URL: ${fileUrl}`);
      
      const response = await axios({
        method: 'GET',
        url: fileUrl,
        responseType: 'stream',
        timeout: 30000,
        maxContentLength: TELEGRAM_MAX_FILE_BYTES,
        maxBodyLength: TELEGRAM_MAX_FILE_BYTES
      });

      const writer = fs.createWriteStream(filePath);
      await streamPipeline(response.data, writer);
      
      const stats = await fs.stat(filePath);
      fileSize = stats.size;
    } 
    else {
      return res.status(400).json({ 
        error: 'No file provided',
        message: 'Please provide a file via form upload or file_url parameter',
        supported_methods: ['multipart/form-data with file field', 'JSON with file_url field']
      });
    }

    // Validate file size (now 6GB)
    if (fileSize > TELEGRAM_MAX_FILE_BYTES) {
      throw new Error(`File too large. Maximum size: ${formatFileSize(TELEGRAM_MAX_FILE_BYTES)}`);
    }

    console.log(`📤 Uploading to Telegram: ${originalName} (${formatFileSize(fileSize)})`);

    // Upload to Telegram with enhanced support
    const message = await uploadLargeFile(filePath, originalName, CHANNEL_ID);
    
    if (!message?.document?.file_id && !message?.media?.document?.id) {
      throw new Error('Telegram upload failed - no file_id returned');
    }

    // Get file ID from different message types
    const fileId = message.document?.file_id || message.media?.document?.id;
    if (!fileId) {
      throw new Error('Could not extract file_id from upload response');
    }

    // Generate URLs
    const downloadLink = makeDownloadUrl(req, fileId, originalName);
    const streamLink = makeStreamUrl(req, fileId, originalName);
    const playerLink = makePlayerUrl(req, fileId, originalName);

    // Determine file type
    const isVideo = isVideoFile(originalName);
    const isAudio = isAudioFile(originalName);

    const response = {
      success: true,
      file_name: originalName,
      file_size: fileSize,
      file_size_formatted: formatFileSize(fileSize),
      file_id: fileId,
      download_url: downloadLink,
      hotlink: downloadLink, // Legacy compatibility
      telegram_message_id: message.message_id || message.id,
      file_type: isVideo ? 'video' : isAudio ? 'audio' : 'document',
      upload_time: new Date().toISOString(),
      max_size_supported: formatFileSize(TELEGRAM_MAX_FILE_BYTES)
    };

    // Add streaming URLs for media files
    if (isVideo || isAudio) {
      response.stream_url = streamLink;
      response.player_url = playerLink;
      response.supports_streaming = true;
    }

    console.log(`✅ Upload successful: ${originalName}`);
    return res.json(response);

  } catch (err) {
    console.error('❌ Upload error:', err);
    
    // Enhanced error messages
    let errorMessage = err.message || 'Upload failed';
    let statusCode = 500;

    if (err.message?.includes('chat not found')) {
      errorMessage = 'Telegram channel not accessible. Please check bot permissions.';
      statusCode = 400;
    } else if (err.message?.includes('too large') || err.code === 'LIMIT_FILE_SIZE') {
      errorMessage = `File too large. Maximum size: ${formatFileSize(TELEGRAM_MAX_FILE_BYTES)}`;
      statusCode = 413;
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      errorMessage = 'Network error. Please check the file URL or try again later.';
      statusCode = 502;
    }

    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      max_size_supported: formatFileSize(TELEGRAM_MAX_FILE_BYTES),
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    // Cleanup
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
});

// ------------------------
// Enhanced Download endpoint with range support
// ------------------------
app.get('/download/:file_id', async (req, res) => {
  try {
    const fileId = req.params.file_id;
    const requestedName = req.query.filename || 'file';
    const fileName = safeFileName(decodeURIComponent(requestedName));

    console.log(`📥 Download request: ${fileName}`);

    // Get file info from Telegram
    const file = await bot.getFile(fileId);
    if (!file?.file_path) {
      throw new Error('File not found on Telegram servers');
    }

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    // Set headers
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');

    // Handle range requests for better download experience
    const range = req.headers.range;
    if (range) {
      try {
        const response = await axios.get(fileUrl, {
          responseType: 'stream',
          headers: { Range: range },
          timeout: 0,
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });
        
        res.status(206);
        res.setHeader('Content-Range', response.headers['content-range']);
        res.setHeader('Content-Length', response.headers['content-length']);
        
        await streamPipeline(response.data, res);
        return;
      } catch (rangeErr) {
        console.log('Range request failed, falling back to full download');
      }
    }

    // Full file download
    const response = await axios.get(fileUrl, {
      responseType: 'stream',
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    await streamPipeline(response.data, res);
    console.log(`✅ Download completed: ${fileName}`);

  } catch (err) {
    console.error('❌ Download error:', err);
    const message = err.message?.includes('not found') ? 'File not found' : 'Download failed';
    return res.status(404).json({ error: message });
  }
});

// ------------------------
// Stream endpoint for direct media streaming
// ------------------------
app.get('/stream/:file_id', async (req, res) => {
  try {
    const fileId = req.params.file_id;
    const requestedName = req.query.filename || 'file';
    const fileName = safeFileName(decodeURIComponent(requestedName));

    console.log(`🎬 Stream request: ${fileName}`);

    const file = await bot.getFile(fileId);
    if (!file?.file_path) {
      throw new Error('File not found');
    }

    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    // Determine content type based on extension
    const ext = path.extname(fileName).toLowerCase();
    let contentType = 'application/octet-stream';
    
    if (VIDEO_EXTENSIONS.includes(ext)) {
      contentType = `video/${ext.substring(1)}`;
    } else if (AUDIO_EXTENSIONS.includes(ext)) {
      contentType = `audio/${ext.substring(1)}`;
    }

    // Set streaming headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    // Handle range requests (essential for video streaming)
    const range = req.headers.range;
    
    if (range) {
      const response = await axios.get(fileUrl, {
        responseType: 'stream',
        headers: { Range: range },
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      res.status(206);
      res.setHeader('Content-Range', response.headers['content-range']);
      res.setHeader('Content-Length', response.headers['content-length']);
      
      await streamPipeline(response.data, res);
    } else {
      const response = await axios.get(fileUrl, {
        responseType: 'stream',
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }

      await streamPipeline(response.data, res);
    }

    console.log(`✅ Stream completed: ${fileName}`);

  } catch (err) {
    console.error('❌ Stream error:', err);
    return res.status(404).json({ error: 'Stream not available' });
  }
});

// ------------------------
// Player page with Plyr
// ------------------------
app.get('/player/:file_id', async (req, res) => {
  try {
    const fileId = req.params.file_id;
    const requestedName = req.query.filename || 'file';
    const fileName = safeFileName(decodeURIComponent(requestedName));
    
    // Check if file exists
    const file = await bot.getFile(fileId);
    if (!file?.file_path) {
      return res.status(404).send('File not found');
    }

    const streamUrl = makeStreamUrl(req, fileId, fileName);
    const isVideo = isVideoFile(fileName);
    const isAudio = isAudioFile(fileName);

    if (!isVideo && !isAudio) {
      return res.status(400).send('File type not supported for streaming');
    }

    const playerHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${fileName} - Hostio Player</title>
    <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            max-width: 90vw;
            max-height: 90vh;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
        }
        .player-wrapper {
            width: 100%;
            max-width: ${isVideo ? '1200px' : '600px'};
            margin: 0 auto;
        }
        .file-info {
            text-align: center;
            color: white;
            margin-bottom: 20px;
        }
        .file-info h1 {
            font-size: 1.5rem;
            margin-bottom: 10px;
            word-break: break-word;
        }
        .hostio-brand {
            color: #00ff88;
            font-weight: bold;
        }
        .download-btn, .back-btn {
            display: inline-block;
            margin: 8px;
            padding: 12px 24px;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            text-decoration: none;
            border-radius: 25px;
            transition: all 0.3s ease;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        .download-btn:hover, .back-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
        .back-btn {
            background: rgba(0, 255, 136, 0.2);
            border: 1px solid rgba(0, 255, 136, 0.3);
        }
        .plyr {
            border-radius: 15px;
            overflow: hidden;
        }
        ${isAudio ? `
        .plyr--audio {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 15px;
        }
        ` : ''}
        @media (max-width: 768px) {
            .container { padding: 15px; }
            .file-info h1 { font-size: 1.2rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="file-info">
            <h1>🎬 ${fileName}</h1>
            <p>Streaming via <span class="hostio-brand">Hostio</span> • Powered by Telegram</p>
            <a href="/hostio" class="back-btn">
                🚀 Back to Hostio
            </a>
            <a href="${makeDownloadUrl(req, fileId, fileName)}" class="download-btn">
                📥 Download File
            </a>
        </div>
        <div class="player-wrapper">
            ${isVideo ? 
                `<video id="player" playsinline controls data-poster="" crossorigin="anonymous">
                    <source src="${streamUrl}" type="video/mp4" />
                    Your browser doesn't support video playback.
                </video>` :
                `<audio id="player" controls crossorigin="anonymous">
                    <source src="${streamUrl}" type="audio/mpeg" />
                    Your browser doesn't support audio playback.
                </audio>`
            }
        </div>
    </div>

    <script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const player = new Plyr('#player', {
                controls: [
                    'play-large', 'restart', 'rewind', 'play', 'fast-forward', 
                    'progress', 'current-time', 'duration', 'mute', 'volume', 
                    ${isVideo ? "'captions', 'settings', 'pip', 'airplay', 'fullscreen'" : "'settings'"}
                ],
                settings: ['captions', 'quality', 'speed'],
                quality: { default: 720, options: [4320, 2880, 2160, 1440, 1080, 720, 576, 480, 360, 240] },
                speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
                ratio: ${isVideo ? "'16:9'" : 'null'},
                loadSprite: false,
                iconUrl: 'https://cdn.plyr.io/3.7.8/plyr.svg'
            });

            player.on('ready', () => {
                console.log('Player ready');
            });

            player.on('error', (event) => {
                console.error('Player error:', event);
                alert('Error loading media. Please try downloading the file instead.');
            });
        });
    </script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(playerHTML);

  } catch (err) {
    console.error('❌ Player error:', err);
    res.status(404).send('<h1>File not found</h1><p>The requested media file could not be found.</p>');
  }
});

// ------------------------
// Root redirect to Hostio
// ------------------------
app.get('/', (req, res) => {
  res.redirect('/hostio');
});

// ------------------------
// API Info endpoint
// ------------------------
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Hostio - Enhanced File Upload & Streaming API',
    version: '2.1.0',
    features: [
      'File uploads up to 6GB',
      'Support for all file types',
      'Video/Audio streaming with Plyr player',
      'Range request support',
      'Rate limiting & security',
      'Multiple upload methods (form, URL)',
      'Telegram bot + client integration',
      'Beautiful web interface'
    ],
    endpoints: {
      'GET /': 'Redirect to Hostio interface',
      'GET /hostio': 'File upload web interface',
      'POST /upload': 'Upload files via form data or URL',
      'GET /download/:file_id': 'Download files',
      'GET /stream/:file_id': 'Stream media files',
      'GET /player/:file_id': 'Media player page',
      'GET /api/info': 'API information'
    },
    limits: {
      max_file_size: TELEGRAM_MAX_FILE_BYTES,
      max_file_size_formatted: formatFileSize(TELEGRAM_MAX_FILE_BYTES),
      supported_video_formats: VIDEO_EXTENSIONS,
      supported_audio_formats: AUDIO_EXTENSIONS
    },
    telegram_config: {
      bot_token: BOT_TOKEN ? 'Configured' : 'Not configured',
      api_id: API_ID ? 'Configured' : 'Not configured',
      channel_id: CHANNEL_ID ? 'Configured' : 'Not configured'
    }
  });
});

// ------------------------
// Health check
// ------------------------
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    max_file_size: formatFileSize(TELEGRAM_MAX_FILE_BYTES)
  });
});

// ------------------------
// 404 handler
// ------------------------
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    available_endpoints: ['/', '/hostio', '/upload', '/download/:file_id', '/stream/:file_id', '/player/:file_id', '/api/info'],
    suggestion: 'Try visiting /hostio for the web interface'
  });
});

// ------------------------
// Global error handler
// ------------------------
app.use((err, req, res, next) => {
  console.error('❌ Global error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    max_file_size_supported: formatFileSize(TELEGRAM_MAX_FILE_BYTES)
  });
});

// ------------------------
// Graceful shutdown
// ------------------------
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully');
  if (telegramClient) {
    telegramClient.disconnect();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully');
  if (telegramClient) {
    telegramClient.disconnect();
  }
  process.exit(0);
});

console.log('🚀 Hostio - Enhanced File Upload & Streaming API ready!');
console.log('📊 Features: 6GB uploads, beautiful web interface, streaming, security');
console.log('🌐 Access the web interface at: /hostio');
console.log('📡 API endpoints available at: /api/info');

module.exports = app;
