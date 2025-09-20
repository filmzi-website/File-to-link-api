# Hostio - 6GB File Upload & Streaming API

## 🚀 Features
- **6GB file upload support** via Telegram Client API
- **Beautiful web interface** at `/hostio`
- **Video/Audio streaming** with Plyr player
- **Multiple upload methods**: Drag & drop, file picker, URL upload
- **Range requests** support for better streaming
- **Security features**: Rate limiting, CORS, Helmet
- **All file types** supported

## 📋 Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Telegram Bot Setup
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Add the bot to your channel as an admin
4. Get your channel ID (use [@userinfobot](https://t.me/userinfobot))

### 3. Telegram App Credentials (for 6GB support)
1. Go to [my.telegram.org](https://my.telegram.org)
2. Create a new application
3. Get your `API_ID` and `API_HASH`

### 4. Configuration
Update the following constants in `api/index.js`:

```javascript
const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';
const CHANNEL_ID = YOUR_CHANNEL_ID_HERE; // e.g., -1001234567890
const API_ID = YOUR_API_ID_HERE; // e.g., 12345678
const API_HASH = "YOUR_API_HASH_HERE"; // e.g., "abcdef1234567890"
```

### 5. Run the Application
```bash
npm start
# or for development
npm run dev
```

## 🌐 Usage

### Web Interface
- Visit `/hostio` for the beautiful upload interface
- Drag & drop files up to 6GB
- Upload from URLs
- Get instant download/streaming links

### API Endpoints
- `POST /upload` - Upload files (form-data or JSON with file_url)
- `GET /download/:file_id` - Download files
- `GET /stream/:file_id` - Stream media files
- `GET /player/:file_id` - Media player page
- `GET /api/info` - API information

### Upload Methods

#### 1. Form Upload
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('/upload', {
  method: 'POST',
  body: formData
});
```

#### 2. URL Upload
```javascript
fetch('/upload', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ file_url: 'https://example.com/file.mp4' })
});
```

## 📡 Response Format

### Successful Upload
```json
{
  "success": true,
  "file_name": "video.mp4",
  "file_size": 1234567890,
  "file_size_formatted": "1.15 GB",
  "file_id": "BQACAgIAAxkDAAICE...",
  "download_url": "https://yourapi.com/download/BQACAgIAAxkDAAICE...?filename=video.mp4",
  "stream_url": "https://yourapi.com/stream/BQACAgIAAxkDAAICE...?filename=video.mp4",
  "player_url": "https://yourapi.com/player/BQACAgIAAxkDAAICE...?filename=video.mp4",
  "file_type": "video",
  "supports_streaming": true,
  "upload_time": "2024-01-15T10:30:00.000Z",
  "max_size_supported": "6 GB"
}
```

### Error Response
```json
{
  "success": false,
  "error": "File too large. Maximum size: 6 GB",
  "max_size_supported": "6 GB"
}
```

## 🔧 Advanced Configuration

### Environment Variables
Create a `.env` file:
```env
NODE_ENV=production
PORT=3000
BOT_TOKEN=your_bot_token_here
CHANNEL_ID=-1001234567890
API_ID=12345678
API_HASH=your_api_hash_here
```

### Rate Limiting
Adjust rate limiting in the code:
```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // requests per window
});
```

## 🎬 Media Streaming Features

### Supported Video Formats
- MP4, MKV, AVI, MOV, WMV, FLV, WebM, M4V, 3GP, TS, M2TS

### Supported Audio Formats
- MP3, WAV, FLAC, AAC, OGG, M4A, WMA

### Player Features
- Range requests support
- Quality selection
- Playback speed control
- Picture-in-picture (video)
- Fullscreen mode
- Mobile responsive

## 🔒 Security Features
- **Helmet.js** for security headers
- **CORS** configuration
- **Rate limiting** on upload endpoints
- **File size validation**
- **Safe filename handling**

## 📊 File Size Limits

| Method | Max Size | Notes |
|--------|----------|--------|
| Telegram Bot API | 50 MB | Standard bot uploads |
| Telegram Client API | 2 GB | Single file via client |
| Chunked Upload | 6 GB | Multiple parts via bot |

## 🚨 Important Notes

1. **Large File Handling**: Files over 2GB are handled differently:
   - If Telegram Client is available: Direct upload up to 2GB per file
   - Otherwise: Chunked upload via bot (multiple messages)

2. **Telegram Client Session**: For 6GB support, you'll need to:
   - Set up phone authentication
   - Save session string for reuse
   - Handle 2FA if enabled

3. **Storage**: Files are temporarily stored in `/tmp/uploads` during processing

## 🛠️ Deployment

### Docker (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Vercel Deployment
```json
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/api/index.js"
    }
  ]
}
```

## 📱 Web Interface Features

- **Responsive design** for all devices
- **Drag & drop** file upload
- **Progress indicators** during upload
- **Multiple upload methods** (file picker, URL)
- **Instant link generation** with copy buttons
- **Error handling** with user-friendly messages
- **File type detection** and appropriate link generation

## 🎯 Use Cases

- **Media hosting** for websites and apps
- **File sharing** with direct links
- **Video streaming** without server storage
- **Backup solutions** using Telegram as storage
- **API endpoints** for other applications

## 🆘 Troubleshooting

### Common Issues

1. **"Chat not found" error**
   - Ensure bot is admin in channel
   - Check channel ID format (should include `-100` prefix)

2. **Large files failing**
   - Verify Telegram Client setup
   - Check file size limits
   - Monitor server memory usage

3. **Streaming not working**
   - Ensure file formats are supported
   - Check if file was uploaded successfully
   - Verify range request support in client

### Debug Mode
Set `NODE_ENV=development` for detailed error messages.

## 📄 License
MIT License - feel free to use for personal and commercial projects.
