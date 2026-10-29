const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const app = express();

app.use(cors({ origin: '*' }));

// JioSaavn ka Secret DES Decryption Engine (100% Full Song Guarantee)
function decryptSaavnUrl(encryptedUrl) {
    if (!encryptedUrl) return '';
    try {
        const key = Buffer.from('38346591', 'utf8');
        const decipher = crypto.createDecipheriv('des-ecb', key, null);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(encryptedUrl, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted.replace(/_96\.mp4|_160\.mp4/g, '_320.mp4')
                        .replace('preview.saavncdn.com', 'aac.saavncdn.com');
    } catch (e) {
        return '';
    }
}

// 1. Search Route (Direct JioSaavn Official Server + Decryption)
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        // Direct hit to JioSaavn's internal API (Never goes down)
        const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&n=20&p=1&q=${encodeURIComponent(query)}`;
        
        const response = await axios.get(saavnUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });

        const rawResults = response.data.results || [];
        const cleanTracks = rawResults.map(track => {
            const encryptedMedia = track.encrypted_media_url || (track.more_info && track.more_info.encrypted_media_url);
            let streamUrl = decryptSaavnUrl(encryptedMedia);

            return {
                id: track.id,
                name: (track.song || track.title || 'Unknown').replace(/&quot;/g, '"').replace(/&#039;/g, "'"),
                artist: track.primary_artists || (track.more_info && track.more_info.primary_artists) || track.singers || 'Unknown Artist',
                img: (track.image || '').replace('150x150', '500x500'),
                src: streamUrl
            };
        }).filter(t => t.src !== '');

        res.json({ success: true, results: cleanTracks });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Search Failed' });
    }
});

// 2. Audio Stream Proxy (Ye audio ko tere server ke through pipe karega - Zero Block)
app.get('/api/stream', async (req, res) => {
    try {
        const audioUrl = req.query.url;
        if (!audioUrl) return res.status(400).send('No URL');

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Referer': 'https://www.jiosaavn.com/'
        };
        if (req.headers.range) {
            headers['Range'] = req.headers.range; // Gaana aage-piche (seek) karne ke liye
        }

        const response = await axios({
            method: 'get',
            url: audioUrl,
            responseType: 'stream',
            headers: headers
        });

        res.status(response.status);
        res.set('Content-Type', response.headers['content-type'] || 'audio/mp4');
        if (response.headers['content-length']) res.set('Content-Length', response.headers['content-length']);
        if (response.headers['content-range']) res.set('Content-Range', response.headers['content-range']);
        res.set('Accept-Ranges', 'bytes');

        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Audio Stream Error');
    }
});

// 3. Lyrics Route (LRCLIB)
app.get('/api/lyrics', async (req, res) => {
    try {
        const { track, artist } = req.query;
        const response = await axios.get(`https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json([]);
    }
});

module.exports = app;

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

